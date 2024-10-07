import { useState, useEffect, useRef, useCallback } from "react";
import io from "socket.io-client";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:turn.anyfirewall.com:443?transport=tcp",
    username: "webrtc",
    credential: "webrtc",
  },
];

export const useWebRTCVideo = (roomId, userDetails, isAdmin) => {
  const [clients, setClients] = useState([]);
  const localMediaStream = useRef(null);
  const peerConnections = useRef({});
  const remoteStreams = useRef({});
  const socket = useRef(null);

  // Initialize socket connection and WebRTC
  useEffect(() => {
    socket.current = io("wss://sared.online:3333", {
      transports: ["websocket"],
    });

    socket.current.on("connect", () => {
      console.log("Connected to socket server");
      socket.current.emit("join", { roomId, user: userDetails });
    });

    // Room clients update
    socket.current.on("room_clients", ({ clients }) => {
      setClients(clients);
    });

    // Initialize WebRTC for the admin (streamer)
    if (isAdmin) {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((stream) => {
          localMediaStream.current = stream;
          // Set up local stream for the admin to see themselves
          addLocalTracksToPeers();
        })
        .catch((error) =>
          console.error("Error accessing media devices:", error)
        );
    }

    // Handle new peer joining
    socket.current.on("add-peer", handleNewPeer);

    // Handle session description
    socket.current.on("session-description", handleSessionDescription);

    // Handle ICE candidate
    socket.current.on("ice-candidate", handleIceCandidate);

    // Handle peer removal
    socket.current.on("remove-peer", handleRemovePeer);

    return () => {
      socket.current.disconnect();
      cleanupConnections();
    };
  }, [roomId, userDetails, isAdmin]);

  const handleNewPeer = async ({ peerId, createOffer }) => {
    if (peerConnections.current[peerId]) return;

    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnections.current[peerId] = connection;

    // Admin should add local media tracks to the connection
    if (isAdmin && localMediaStream.current) {
      localMediaStream.current.getTracks().forEach((track) => {
        connection.addTrack(track, localMediaStream.current);
      });
    }

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current.emit("relay-ice", {
          peerId,
          icecandidate: event.candidate,
        });
      }
    };

    connection.ontrack = (event) => {
      remoteStreams.current[peerId] = event.streams[0];
    };

    if (createOffer) {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socket.current.emit("relay-sdp", { peerId, sessionDescription: offer });
    }
  };

  const handleSessionDescription = async ({ peerId, sessionDescription }) => {
    const connection = peerConnections.current[peerId];
    if (!connection) return;

    await connection.setRemoteDescription(
      new RTCSessionDescription(sessionDescription)
    );
    if (sessionDescription.type === "offer") {
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      socket.current.emit("relay-sdp", { peerId, sessionDescription: answer });
    }
  };

  const handleIceCandidate = async ({ peerId, icecandidate }) => {
    const connection = peerConnections.current[peerId];
    if (connection) {
      await connection.addIceCandidate(new RTCIceCandidate(icecandidate));
    }
  };

  const handleRemovePeer = ({ peerId }) => {
    const connection = peerConnections.current[peerId];
    if (connection) {
      connection.close();
      delete peerConnections.current[peerId];
    }
    delete remoteStreams.current[peerId];
    setClients((clients) => clients.filter((client) => client._id !== peerId));
  };

  const addLocalTracksToPeers = () => {
    if (localMediaStream.current) {
      Object.keys(peerConnections.current).forEach((peerId) => {
        const connection = peerConnections.current[peerId];
        localMediaStream.current.getTracks().forEach((track) => {
          connection.addTrack(track, localMediaStream.current);
        });
      });
    }
  };

  const cleanupConnections = () => {
    Object.keys(peerConnections.current).forEach((peerId) => {
      peerConnections.current[peerId].close();
      delete peerConnections.current[peerId];
    });
    if (localMediaStream.current) {
      localMediaStream.current.getTracks().forEach((track) => track.stop());
    }
  };

  return { clients, localMediaStream, remoteStreams };
};
