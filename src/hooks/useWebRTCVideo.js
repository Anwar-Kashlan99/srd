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
  const videoRef = useRef(null); // Video element reference

  const audioElements = useRef({});
  const connections = useRef({});
  const clientsRef = useRef([]); // Keep viewers ref in sync
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
    const initSocketConnection = async () => {
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
      socket.current.on(ACTIONS.ROOM_CLIENTS, handleRoomClients);

      socket.current.on(ACTIONS.ERROR, handleErrorRoom);
      socket.current.on("ROOM_ENDED_REDIRECT", handleRoomEnded);

      // Emit the JOIN action
      socket.current.emit(ACTIONS.JOIN, {
        roomId,
        user: { ...userDetails, role: userDetails.role || "audience" },
      });
    };

    initSocketConnection();

    return () => {
      cleanupConnections();
    };
  }, [roomId, userDetails]);

  const handleRoomClients = ({ clients }) => {
    const adminClient = clients.find((client) => client.role === "admin");

    if (adminClient && (!streamer || streamer._id !== adminClient._id)) {
      setStreamer(adminClient);

      if (userDetails._id === adminClient._id) {
        captureStreamerMedia(); // Streamer captures media
      }
    }

    const audienceClients = clients.filter(
      (client) => client.role === "audience"
    );
    setViewers(audienceClients); // Viewers list
  };

  const cleanupConnections = () => {
    Object.keys(connections.current).forEach((peerId) => {
      connections.current[peerId].close();
    });

    if (socket.current) {
      socket.current.disconnect();
      socket.current = null;
    }
  };

  const captureStreamerMedia = async () => {
    if (localMediaStream.current) return; // Already captured media

    try {
      const videoConstraints = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      };

      localMediaStream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: videoConstraints,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = localMediaStream.current;
        videoRef.current.oncanplay = () => videoRef.current.play();
      }

      addLocalTracksToPeers(); // Share tracks with viewers
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
    if (user.role === "audience" && connections.current[peerId]) return; // Skip if already connected

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    connections.current[peerId] = connection;

    // Add streamer's tracks to the connection for viewers
    if (localMediaStream.current) {
      localMediaStream.current.getTracks().forEach((track) => {
        connection.addTrack(track, localMediaStream.current);
      });
    }

    connection.ontrack = ({ streams: [remoteStream] }) => {
      // Only handle if the user is a viewer
      if (user.role === "audience") {
        console.log(
          `Received remote stream from streamer for viewer ${peerId}`
        );
        setRemoteStream(user, remoteStream); // Display remote stream for the viewer
      }
    };

    if (createOffer) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      socket.current.emit(ACTIONS.RELAY_SDP, {
        peerId,
        sessionDescription: offer,
      });
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
    if (user.role !== "audience") return; // Ensure only viewers receive the stream

    const videoElement = document.getElementById(`video-${user._id}`);
    if (!videoElement) {
      console.error(`Video element for user ${user.username} not found.`);
      return;
    }

    videoElement.srcObject = remoteStream;
    videoElement.oncanplay = () => videoElement.play();
  };

  const handleIceCandidate = async ({ peerId, icecandidate }) => {
    const connection = connections.current[peerId];
    if (connection) {
      if (connection.remoteDescription) {
        await connection.addIceCandidate(new RTCIceCandidate(icecandidate));
      }
    }
  };

  const handleRemovePeer = ({ peerId, userId }) => {
    if (connections.current[peerId]) {
      connections.current[peerId].close();
      delete connections.current[peerId];
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

        // Avoid adding duplicate tracks to the connection
        const senders = connection.getSenders();
        localMediaStream.current.getTracks().forEach((track) => {
          if (!senders.find((sender) => sender.track === track)) {
            console.log(`Adding track to peer ${peerId}`);
            connection.addTrack(track, localMediaStream.current); // Add the track if it's not already added
          }
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
    if (streamer._id !== userId) return; // Ensure only the streamer can mute

    localMediaStream.current?.getTracks().forEach((track) => {
      if (track.kind === "audio") track.enabled = !isMute;
    });

    // Notify other users
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
    videoRef,
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
