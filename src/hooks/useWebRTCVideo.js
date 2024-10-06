import { useEffect, useRef, useCallback, useState } from "react";

import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import freeice from "freeice";
import { ACTIONS } from "../actionsSrdHouse";
import { useStateWithCallback } from "./useStateWithCallback";
import { socketInitLive } from "../socket";

export const useWebRTCVideo = (roomId, userDetails) => {
  const [streamer, setStreamer] = useStateWithCallback(null); // Single streamer object
  const [viewers, setViewers] = useStateWithCallback([]); // List of viewers

  const [messages, setMessages] = useState([]);

  const audioElements = useRef({});
  const connections = useRef({});
  const clientsRef = useRef([]);
  const socket = useRef(null);
  const localMediaStream = useRef(null);

  const navigate = useNavigate();

  // Keep the viewers list in sync with a ref to avoid stale closures
  useEffect(() => {
    clientsRef.current = viewers;
  }, [viewers]);

  useEffect(() => {
    const initChat = async () => {
      try {
        socket.current = socketInitLive();

        if (!socket.current) {
          console.error("Socket initialization failed");
          return;
        }

        // Setup listeners
        socket.current.on(ACTIONS.JOIN, handleJoin);
        socket.current.on(ACTIONS.ADD_PEER, handleNewPeer);
        socket.current.on(ACTIONS.SESSION_DESCRIPTION, setRemoteMedia);
        socket.current.on(ACTIONS.ICE_CANDIDATE, handleIceCandidate);
        socket.current.on(ACTIONS.REMOVE_PEER, handleRemovePeer);
        socket.current.on(ACTIONS.MESSAGE, handleMessageReceived);
        socket.current.on(ACTIONS.MUTE, ({ userId }) =>
          handleSetMute(true, userId)
        );
        socket.current.on(ACTIONS.UNMUTE, ({ userId }) =>
          handleSetMute(false, userId)
        );

        // Room clients listener
        socket.current.on(ACTIONS.ROOM_CLIENTS, ({ roomId, clients }) => {
          // Identify streamer and viewers
          clients.forEach((client) => {
            if (client._id === userDetails._id) {
              setStreamer(client); // You are the streamer
              captureMedia(); // Only the streamer captures media
            } else {
              setViewers((prevViewers) => [...prevViewers, client]); // Add a viewer
            }
          });
        });
        socket.current.on(ACTIONS.ERROR, handleErrorRoom);
        socket.current.on("ROOM_ENDED_REDIRECT", handleRoomEnded);

        // Emit the JOIN action
        socket.current.emit(ACTIONS.JOIN, { roomId, user: userDetails });
      } catch (error) {
        console.error("Error initializing chat:", error);
      }
    };

    initChat();

    return () => {
      if (socket.current && socket.current.connected) {
        cleanupConnections();
      }
    };
  }, [roomId, userDetails]);

  const cleanupConnections = useCallback(() => {
    for (let peerId in connections.current) {
      if (connections.current[peerId]) {
        connections.current[peerId].close();
        delete connections.current[peerId];
      }
    }
    if (socket.current) {
      Object.values(ACTIONS).forEach((action) => socket.current.off(action));
      socket.current.emit(ACTIONS.LEAVE, { roomId });
      socket.current.disconnect(); // Ensure this is called once
      socket.current = null;
    }

    for (let userId in audioElements.current) {
      delete audioElements.current[userId];
    }

    console.log("All socket listeners removed and cleanup complete.");
  }, [roomId]);

  const captureMedia = async () => {
    if (localMediaStream.current) {
      console.log("Media stream already exists. Skipping new capture.");
      return; // Exit early if the stream already exists
    }

    try {
      const videoConstraints = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      };

      // Capture media stream
      localMediaStream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: videoConstraints,
      });

      console.log("Streamer media captured with high quality.");

      const videoElement = document.getElementById(`video-${userDetails._id}`);
      if (videoElement) {
        videoElement.srcObject = localMediaStream.current;
        videoElement.oncanplay = () => {
          videoElement.play().catch(console.error);
        };
      }

      // Now add local tracks to all peers
      addLocalTracksToPeers();
    } catch (error) {
      console.error("Error capturing media:", error);
      toast.error(
        "Error capturing media. Please check camera/microphone permissions."
      );
    }
  };

  const handleJoin = ({ user }) => {
    if (user._id === userDetails._id) {
      setStreamer(user); // You are the streamer
    } else {
      setViewers((existingViewers) => [...existingViewers, user]); // Add a viewer
    }
  };

  const handleNewPeer = async ({ peerId, createOffer, user }) => {
    try {
      if (connections.current[peerId]) return; // Skip if connection exists

      const iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        // Add TURN servers if needed
      ];

      const connection = new RTCPeerConnection({ iceServers });
      connections.current[peerId] = connection;

      // If you're the streamer, add your media tracks to the peer connection
      if (userDetails._id === streamer._id && localMediaStream.current) {
        localMediaStream.current.getTracks().forEach((track) => {
          connection.addTrack(track, localMediaStream.current);
        });
      }

      // Handle remote track received from other peers (for the viewer)
      connection.ontrack = ({ streams: [remoteStream] }) => {
        setRemoteStream(user, remoteStream); // Attach the viewer's stream
      };

      if (createOffer) {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        socket.current.emit(ACTIONS.RELAY_SDP, {
          peerId,
          sessionDescription: offer,
        });
      }
    } catch (error) {
      console.error("Error handling new peer:", error);
    }
  };

  //
  const setRemoteMedia = async ({ peerId, sessionDescription }) => {
    const connection = connections.current[peerId];
    if (!connection) return;

    try {
      await connection.setRemoteDescription(
        new RTCSessionDescription(sessionDescription)
      );

      if (sessionDescription.type === "offer") {
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.current.emit(ACTIONS.RELAY_SDP, {
          peerId,
          sessionDescription: answer,
        });
      }

      // Add any queued ICE candidates after the remote description is set
      if (connection.queuedIceCandidates) {
        for (const candidate of connection.queuedIceCandidates) {
          await connection.addIceCandidate(new RTCIceCandidate(candidate));
        }
        connection.queuedIceCandidates = [];
      }
    } catch (error) {
      console.error("Error setting remote description", error);
    }
  };
  //
  const setRemoteStream = (user, remoteStream) => {
    const videoElement = document.getElementById(`video-${user._id}`);

    if (videoElement) {
      if (videoElement.srcObject !== remoteStream) {
        videoElement.srcObject = remoteStream;
      }
      videoElement.play().catch((error) => {
        console.error("Error playing the remote video stream:", error);
      });
    }
  };

  const handleIceCandidate = async ({ peerId, icecandidate }) => {
    const connection = connections.current[peerId];
    if (connection) {
      try {
        if (connection.remoteDescription) {
          await connection.addIceCandidate(new RTCIceCandidate(icecandidate));
        } else {
          // Queue ICE candidates if remote description is not set
          connection.queuedIceCandidates = connection.queuedIceCandidates || [];
          connection.queuedIceCandidates.push(icecandidate);
        }
      } catch (error) {
        console.error(`Error adding ICE candidate for peer ${peerId}:`, error);
      }
    }
  };
  const handleRemovePeer = ({ peerId, userId }) => {
    if (connections.current[peerId]) {
      connections.current[peerId].close();
      delete connections.current[peerId];
    }

    if (userId !== streamer._id) {
      setViewers((prevViewers) =>
        prevViewers.filter((viewer) => viewer._id !== userId)
      );
    }
  };

  const handleSetMute = (mute, userId) => {
    if (userId === streamer._id) {
      // Handle possible errors in toggling tracks
      if (localMediaStream.current) {
        localMediaStream.current.getTracks().forEach((track) => {
          if (track.kind === "audio") {
            track.enabled = !mute;
            console.log(`Track ${track.kind} enabled: ${track.enabled}`);
          }
        });
      }
    }
  };

  const addLocalTracksToPeers = () => {
    if (localMediaStream.current) {
      Object.keys(connections.current).forEach((peerId) => {
        const connection = connections.current[peerId];

        localMediaStream.current.getTracks().forEach((track) => {
          connection.addTrack(track, localMediaStream.current);
        });
      });
    }
  };
  const handleMessageReceived = (data) => {
    console.log("Received message data:", data);

    if (!data || !data.user || !data.message) {
      console.error(
        "Received message is undefined or has missing fields:",
        data
      );
      return;
    }

    const { user, message } = data;

    setMessages((prevMessages) => [
      ...prevMessages,
      { userId: user._id, username: user.username, message },
    ]);
  };

  const handleRoomEnded = () => {
    toast("Live ended", { icon: "⚠️" });
    navigate("/allbroadcasts");
  };

  const handleErrorRoom = () => {
    toast("You are blocked from this live");
    navigate("/allbroadcasts");
  };

  const provideRef = (instance, userId) => {
    audioElements.current[userId] = instance;
  };

  const handleMute = (isMute, userId) => {
    // Check if the user is the streamer and ensure localMediaStream is available
    if (clientsRef.current[0]._id !== userId) {
      console.log("Viewers cannot mute/unmute.");
      return;
    }

    if (!localMediaStream.current) {
      console.log("No media stream available to mute/unmute.");
      return; // Exit early if localMediaStream is null
    }

    // Toggle mute/unmute for audio tracks
    localMediaStream.current.getTracks().forEach((track) => {
      if (track.kind === "audio") {
        track.enabled = !isMute;
      }
    });

    // Notify other clients about the mute/unmute action
    socket.current.emit(isMute ? ACTIONS.MUTE : ACTIONS.UNMUTE, {
      roomId,
      userId,
    });
  };

  const endRoom = () => {
    if (streamer._id === userDetails._id && socket.current) {
      socket.current.emit(ACTIONS.END_ROOM, roomId);
      cleanupConnections();
      navigate("/allbroadcasts");
    }
  };

  const blockUser = (userId) => {
    if (socket.current) {
      socket.current.emit(ACTIONS.BLOCK_USER, { roomId, userId });
    }
  };

  const sendMessage = (text) => {
    if (socket.current) {
      socket.current.emit(ACTIONS.MESSAGE, {
        roomId,
        user: userDetails,
        text,
      });
    }
  };
  return {
    streamer,
    viewers,
    provideRef,
    handleMute,
    endRoom,
    blockUser,
    messages,
    sendMessage,
  };
};
