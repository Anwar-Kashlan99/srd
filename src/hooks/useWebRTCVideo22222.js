import { useEffect, useRef, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import io from "socket.io-client";
import freeice from "freeice";
import { ACTIONS } from "../actionsSrdHouse";
import { useStateWithCallback } from "./useStateWithCallback";
import { socketInitLive } from "../socket";

export const useWebRTCVideo = (roomId, userDetails) => {
  const [clients, setClients] = useStateWithCallback([]);
  const [messages, setMessages] = useState([]);

  const audioElements = useRef({});
  const connections = useRef({});
  const clientsRef = useRef([]);
  const socket = useRef(null);
  const localMediaStream = useRef(null);

  const navigate = useNavigate();
  const currentUser = clients.find((client) => client._id === userDetails._id);

  const isAdmin = currentUser?.role === "admin";
  const isMute = !isAdmin; // Mute if not admin

  // Helper function to add new clients
  const addNewClient = useCallback(
    (newClient) => {
      setClients((existingClients) => {
        const clientIndex = existingClients.findIndex(
          (client) => client._id === newClient._id
        );

        if (clientIndex !== -1) {
          // Update existing client
          const updatedClients = [...existingClients];
          updatedClients[clientIndex] = {
            ...updatedClients[clientIndex],
            ...newClient,
          };
          return updatedClients;
        } else {
          // Add new client
          return [...existingClients, newClient];
        }
      });
    },
    [setClients]
  );

  // Keep the clients list in sync with a ref to avoid stale closures
  useEffect(() => {
    clientsRef.current = clients;
  }, [clients]);

  // Socket and WebRTC Initialization
  useEffect(() => {
    const initSocketAndWebRTC = async () => {
      try {
        socket.current = socketInitLive();

        if (!socket.current) {
          console.error("Socket initialization failed");
          return;
        }

        // Handle incoming socket events
        socket.current.on("add-peer", handleNewPeer);
        socket.current.on("session-description", setRemoteMedia);
        socket.current.on("ice-candidate", handleIceCandidate);
        socket.current.on("remove-peer", handleRemovePeer);
        socket.current.on("ROOM_ENDED_REDIRECT", handleRoomEnded);

        socket.current.emit("join", { roomId, user: userDetails });

        if (isAdmin) {
          await captureMedia();
        }
      } catch (error) {
        console.error("Error initializing WebRTC or socket:", error);
      }
    };

    initSocketAndWebRTC();

    return () => {
      if (socket.current) {
        cleanupConnections();
      }
    };
  }, [roomId, userDetails, addNewClient]);

  // Capture Local Media (For Admin Only)
  // Capture Local Media (For Admin Only)
  const captureMedia = async () => {
    try {
      // Capture video and audio stream
      localMediaStream.current = await navigator.mediaDevices.getUserMedia({
        audio: !isMute, // Capture audio only if not muted
        video: true, // Capture video
      });

      console.log("Media stream captured.", localMediaStream.current);

      // Attach local stream to video element for local preview
      const localVideoElement = document.getElementById(`local-video`);
      if (localVideoElement) {
        localVideoElement.srcObject = localMediaStream.current;
        await localVideoElement.play().catch((error) => {
          console.error("Error playing local video:", error);
        });
      }

      // Add local media tracks to peer connections
      addLocalTracksToPeers();
    } catch (error) {
      console.error("Error capturing media:", error);
      toast.error(
        "Please ensure your browser has permission to access the camera and microphone."
      );
    }
  };

  // Add Local Media Tracks to All Peers
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

  // Handle New Peer Joining
  const handleNewPeer = async ({ peerId, createOffer, user }) => {
    try {
      if (!connections.current[peerId]) {
        const connection = await createPeerConnection();
        connections.current[peerId] = connection;

        connection.onicecandidate = (event) => {
          if (event.candidate) {
            socket.current.emit("relay-ice", {
              peerId,
              icecandidate: event.candidate,
            });
          }
        };

        connection.ontrack = ({ streams: [remoteStream] }) => {
          const videoElement = document.getElementById(`video-${user._id}`);
          if (videoElement) {
            videoElement.srcObject = remoteStream;
            videoElement.play().catch(console.error);
          }
        };

        if (createOffer) {
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          socket.current.emit("relay-sdp", {
            peerId,
            sessionDescription: offer,
          });
        }
      }
    } catch (error) {
      console.error("Error handling new peer:", error);
    }
  };

  // Handle Session Description (SDP) from Peer
  // Handle Session Description (SDP) from Peer
  const setRemoteMedia = async ({ peerId, sessionDescription }) => {
    const connection = connections.current[peerId];
    if (!connection) return;

    try {
      // Check signaling state before setting remote description
      if (
        connection.signalingState === "stable" &&
        sessionDescription.type === "answer"
      ) {
        console.warn(
          `Peer ${peerId} is already stable, skipping setRemoteDescription.`
        );
        return;
      }

      await connection.setRemoteDescription(
        new RTCSessionDescription(sessionDescription)
      );

      // Handle offers and create answers only if necessary
      if (sessionDescription.type === "offer") {
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        socket.current.emit("relay-sdp", {
          peerId,
          sessionDescription: answer,
        });
      }
    } catch (error) {
      console.error("Error setting remote description:", error);
    }
  };

  // Handle Incoming ICE Candidate
  const handleIceCandidate = async ({ peerId, icecandidate }) => {
    const connection = connections.current[peerId];
    if (connection) {
      try {
        await connection.addIceCandidate(new RTCIceCandidate(icecandidate));
        console.log(`ICE candidate added for peer ${peerId}`);
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    }
  };

  // Handle Peer Removal
  const handleRemovePeer = ({ peerId, userId }) => {
    if (connections.current[peerId]) {
      connections.current[peerId].close();
      delete connections.current[peerId];
    }
    setClients((list) => list.filter((client) => client._id !== userId));
  };

  // Create New Peer Connection
  const createPeerConnection = async () => {
    const configuration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:stun.relay.metered.ca:80" },
        {
          urls: "turn:global.relay.metered.ca:80",
          username: "c8090ecaa7eb2bc0bb45fcd3",
          credential: "dr9/NfX7eSdwKpFF",
        },
        {
          urls: "turn:global.relay.metered.ca:80?transport=tcp",
          username: "c8090ecaa7eb2bc0bb45fcd3",
          credential: "dr9/NfX7eSdwKpFF",
        },
        {
          urls: "turn:global.relay.metered.ca:443",
          username: "c8090ecaa7eb2bc0bb45fcd3",
          credential: "dr9/NfX7eSdwKpFF",
        },
        {
          urls: "turns:global.relay.metered.ca:443?transport=tcp",
          username: "c8090ecaa7eb2bc0bb45fcd3",
          credential: "dr9/NfX7eSdwKpFF",
        },
      ],
    };
    return new RTCPeerConnection(configuration);
  };

  // Clean Up Connections and Sockets
  const cleanupConnections = () => {
    Object.keys(connections.current).forEach((peerId) => {
      if (connections.current[peerId]) {
        connections.current[peerId].close();
        delete connections.current[peerId];
      }
    });

    if (socket.current && socket.current.connected) {
      socket.current.disconnect();
      socket.current = null;
    }

    console.log("Cleaned up connections and socket.");
  };

  // End the Room (Admin)
  const endRoom = () => {
    if (isAdmin && socket.current) {
      socket.current.emit("end_room", roomId);
      cleanupConnections();
      navigate("/srdhouse");
    }
  };

  // Handle Room Ended Event
  const handleRoomEnded = () => {
    toast("Room ended", { icon: "⚠️" });
    navigate("/srdhouse");
  };

  return {
    clients,

    endRoom,
    messages,
    sendMessage: (text) => {
      socket.current.emit("message", { roomId, user: userDetails, text });
    },
  };
};
