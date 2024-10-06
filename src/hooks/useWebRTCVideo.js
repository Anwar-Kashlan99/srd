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
    console.log("Streamer set:", streamer);
  }, [streamer]);
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
          console.log("ROOM_CLIENTS:", clients);

          // Find the user with the "admin" role and set them as the streamer
          const adminClient = clients.find((client) => client.role === "admin");
          if (adminClient && (!streamer || streamer._id !== adminClient._id)) {
            console.log("Setting the admin as the streamer:", adminClient);
            setStreamer(adminClient); // Set the admin as the streamer
            if (userDetails._id === adminClient._id) {
              captureMedia(); // Capture media only for the streamer (admin)
            }
          }

          // Set all other users with "audience" role as viewers
          const audienceClients = clients.filter(
            (client) => client.role === "audience"
          );
          setViewers(audienceClients);
        });

        socket.current.on(ACTIONS.ERROR, handleErrorRoom);
        socket.current.on("ROOM_ENDED_REDIRECT", handleRoomEnded);

        // Emit the JOIN action
        socket.current.emit(ACTIONS.JOIN, {
          roomId,
          user: { ...userDetails, role: userDetails.role || "audience" },
        });
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

    console.log("All socket listeners removed and cleanup complete.");
  }, [roomId]);

  const captureMedia = async () => {
    if (localMediaStream.current) {
      console.log("Media stream already exists. Skipping new capture.");
      return; // Don't capture media again if it's already captured
    }

    try {
      const videoConstraints = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      };

      // Only capture the streamer's media
      localMediaStream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: videoConstraints,
      });

      console.log("Streamer media captured.");

      const videoElement = document.getElementById(`video-${userDetails._id}`);
      if (videoElement) {
        videoElement.srcObject = localMediaStream.current;
        videoElement.oncanplay = () => videoElement.play();
      }

      // Add local tracks to all peer connections for viewers
      addLocalTracksToPeers();
    } catch (error) {
      console.error("Error capturing media:", error);
      toast.error(
        "Error capturing media. Check camera/microphone permissions."
      );
    }
  };

  const handleJoin = ({ user }) => {
    if (streamer) {
      setViewers((prevViewers) => [...prevViewers, user]); // New user is a viewer
    } else {
      setStreamer(user); // First user becomes the streamer
    }
  };

  const handleNewPeer = async ({ peerId, createOffer, user }) => {
    try {
      console.log(
        `New peer joined: ${peerId}, User: ${user.username}, Role: ${user.role}`
      );

      // Ensure the user object is valid and the role is properly set
      if (!user || !user._id || !user.role) {
        console.error("Invalid user data or missing role:", user);
        return;
      }

      // Avoid creating duplicate connections for the same peer
      if (connections.current[peerId]) {
        console.log(
          `Connection for peer ${peerId} already exists. Skipping creation.`
        );
        return;
      }

      // Initialize a new peer connection
      const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
      const connection = new RTCPeerConnection({ iceServers });
      connections.current[peerId] = connection;

      // Only add tracks if the peer is a viewer (audience)
      if (localMediaStream.current && user.role === "audience") {
        console.log("Adding local media tracks to audience peer connection.");
        localMediaStream.current.getTracks().forEach((track) => {
          connection.addTrack(track, localMediaStream.current);
        });
      }

      // Handle remote track received (for the viewer)
      connection.ontrack = ({ streams: [remoteStream] }) => {
        console.log(`Received remote stream from peer ${peerId}`);
        setRemoteStream(user, remoteStream); // Display the remote stream
      };

      if (createOffer) {
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        console.log(`Sending SDP offer to peer ${peerId}`);
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
      console.log(`Setting remote stream for user ${user._id}`);
      if (videoElement.srcObject !== remoteStream) {
        videoElement.srcObject = remoteStream;
      }
      videoElement.play().catch((error) => {
        console.error("Error playing the remote video stream:", error);
      });
    } else {
      console.log(`Video element for user ${user._id} not found.`);
    }
  };

  const handleIceCandidate = async ({ peerId, icecandidate }) => {
    const connection = connections.current[peerId];
    if (connection) {
      try {
        if (connection.remoteDescription) {
          await connection.addIceCandidate(new RTCIceCandidate(icecandidate));
        } else {
          connection.queuedIceCandidates = connection.queuedIceCandidates || [];
          connection.queuedIceCandidates.push(icecandidate); // Queue ICE candidates if remote description isn't set yet
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

    if (userId === streamer?._id) {
      setStreamer(null); // If streamer leaves
    } else {
      setViewers((prevViewers) =>
        prevViewers.filter((viewer) => viewer._id !== userId)
      );
    }
  };

  const handleSetMute = (mute, userId) => {
    if (userId === userDetails._id && localMediaStream.current) {
      localMediaStream.current.getTracks().forEach((track) => {
        if (track.kind === "audio") {
          track.enabled = !mute;
        }
      });
    }
  };

  const addLocalTracksToPeers = () => {
    if (localMediaStream.current) {
      console.log("Adding local media tracks to all peer connections.");
      Object.keys(connections.current).forEach((peerId) => {
        const connection = connections.current[peerId];

        // Check if the track has already been added to avoid adding duplicates
        const senders = connection.getSenders();
        localMediaStream.current.getTracks().forEach((track) => {
          if (!senders.find((sender) => sender.track === track)) {
            console.log(`Adding track to peer ${peerId}`);
            connection.addTrack(track, localMediaStream.current); // Add the track if it's not already added
          } else {
            console.log(`Track already added to peer ${peerId}. Skipping.`);
          }
        });
      });
    } else {
      console.log("No local media stream to add tracks from.");
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
    cleanupConnections();
    navigate("/allbroadcasts");
  };

  const handleErrorRoom = () => {
    toast("You are blocked from this live");
    cleanupConnections();
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
