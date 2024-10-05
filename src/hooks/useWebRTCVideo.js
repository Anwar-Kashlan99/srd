import { useEffect, useRef, useCallback, useState } from "react";

import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
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
          setClients(clients, () => {
            if (clients.length && clients[0]._id === userDetails._id) {
              console.log("You are the streamer.");
              captureMedia(); // Capture media when clients array is ready and user is the streamer
            } else {
              console.log("You are a viewer.");
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
  }, [roomId, userDetails, addNewClient]);

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
      return; // Avoid re-capturing media stream
    }
    console.log("Requesting media permissions...");
    try {
      // Define video constraints for high quality
      const videoConstraints = {
        width: { ideal: 1920 }, // Ideal width for HD video
        height: { ideal: 1080 }, // Ideal height for HD video
        frameRate: { ideal: 30 }, // Requesting 30 FPS for smoother video
        aspectRatio: 16 / 9, // Optional, if you want to lock the aspect ratio
      };

      localMediaStream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: videoConstraints, // Applying video constraints for high quality
      });
      console.log("Media captured successfully", localMediaStream.current);
      console.log("Streamer media captured with high quality.");

      const videoElement = document.getElementById(`video-${userDetails._id}`);
      if (videoElement) {
        if (videoElement.srcObject !== localMediaStream.current) {
          videoElement.srcObject = localMediaStream.current;
        }

        videoElement.oncanplay = () => {
          videoElement.play().catch((error) => {
            console.error("Error playing video stream:", error);
          });
        };
      }

      addLocalTracksToPeers(); // Add local media tracks to peer connections
    } catch (error) {
      console.error("Error capturing media:", error);
      toast.error(
        "Error capturing media. Please ensure your browser has permission to access the microphone and camera."
      );
    }
  };

  const handleJoin = ({ user }) => {
    addNewClient({ ...user });
  };

  const handleNewPeer = async ({ peerId, createOffer, user }) => {
    try {
      if (connections.current[peerId]) return;
      const iceServers = [
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
      ];
      const connection = new RTCPeerConnection({ iceServers });
      connections.current[peerId] = connection;

      // Check if localMediaStream is available before adding tracks
      if (localMediaStream.current) {
        localMediaStream.current.getTracks().forEach((track) => {
          connection.addTrack(track, localMediaStream.current);
        });
      } else {
        console.error("localMediaStream is null. Cannot add tracks.");
        return;
      }

      // Receive remote tracks (from other peers)
      connection.ontrack = ({ streams: [remoteStream] }) => {
        setRemoteStream(user, remoteStream);
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
      // Check the connection state before setting the remote description
      if (
        connection.signalingState !== "stable" ||
        sessionDescription.type === "offer"
      ) {
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

        // Add queued ICE candidates after setting the remote description
        if (connection.queuedIceCandidates) {
          for (const candidate of connection.queuedIceCandidates) {
            await connection.addIceCandidate(new RTCIceCandidate(candidate));
          }
          connection.queuedIceCandidates = [];
        }
      } else {
        console.warn(
          `Connection state is ${connection.signalingState}, skipping setRemoteDescription.`
        );
      }
    } catch (error) {
      console.error("Error setting remote description", error);
    }
  };
  //
  const setRemoteStream = (user, remoteStream) => {
    // Find the video element by user ID or dynamically create it
    const videoElement = document.getElementById(`video-${user._id}`);

    if (videoElement) {
      // If the stream is different or not set, set it
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
        if (connection.remoteDescription && connection.remoteDescription.type) {
          await connection.addIceCandidate(new RTCIceCandidate(icecandidate));
          connection.onicecandidate = (event) => {
            if (event.candidate) {
              socket.current.emit(ACTIONS.RELAY_ICE, {
                peerId,
                icecandidate: event.candidate,
              });
            }
          };
          console.log(`ICE candidate added for peer ${peerId}`);
        } else {
          // Queue the ICE candidate until remote description is set
          connection.queuedIceCandidates = connection.queuedIceCandidates || [];
          connection.queuedIceCandidates.push(icecandidate);
          console.log(`ICE candidate queued for peer ${peerId}`);
        }
      } catch (error) {
        console.error(`Error adding ICE candidate for peer ${peerId}:`, error);
      }
    } else {
      console.error(`Connection not found for peer ${peerId}`);
    }
  };
  const handleRemovePeer = ({ peerId, userId }) => {
    if (connections.current[peerId]) {
      connections.current[peerId].close();
      delete connections.current[peerId];
    }

    setClients((prevClients) =>
      prevClients.filter((client) => client._id !== userId)
    );
  };

  const handleSetMute = (mute, userId) => {
    setClients((prevClients) =>
      prevClients.map((client) =>
        client._id === userId
          ? { ...client, muted: mute, speaking: mute ? false : client.speaking }
          : client
      )
    );

    if (userId === userDetails._id) {
      // Handle possible errors in toggling tracks
      if (localMediaStream.current) {
        localMediaStream.current.getTracks().forEach((track) => {
          if (track.kind === "audio") {
            try {
              track.enabled = !mute;
              console.log(`Track ${track.kind} enabled: ${track.enabled}`);
            } catch (error) {
              console.error("Error enabling/disabling audio track:", error);
            }
          }
        });
      }
    }
  };

  const addLocalTracksToPeers = () => {
    if (localMediaStream.current) {
      Object.keys(connections.current).forEach((peerId) => {
        const connection = connections.current[peerId];
        const senders = connection.getSenders();

        localMediaStream.current.getTracks().forEach((track) => {
          const trackAlreadyAdded = senders.some(
            (sender) => sender.track === track
          );

          if (!trackAlreadyAdded) {
            const sender = connection.addTrack(track, localMediaStream.current);

            // If the track is video, set a higher bitrate for better quality
            if (track.kind === "video") {
              const parameters = sender.getParameters();
              if (!parameters.encodings) {
                parameters.encodings = [{}];
              }

              // Set target bitrate for high-quality streaming
              parameters.encodings[0].maxBitrate = 2500000; // 2.5 Mbps for high quality
              parameters.encodings[0].minBitrate = 1000000; // 1 Mbps minimum to avoid too low quality
              sender.setParameters(parameters);
            }
          } else {
            const sender = senders.find((sender) => sender.track === track);
            if (sender) {
              sender.replaceTrack(track);
            }
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
    toast("Room ended", { icon: "⚠️" });
    navigate("/srdhouse");
  };

  const handleErrorRoom = () => {
    toast("You are blocked from this room");
    navigate("/srdhouse");
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
    if (clientsRef.current[0]._id === userDetails._id && socket.current) {
      socket.current.emit(ACTIONS.END_ROOM, roomId);
      cleanupConnections();
      navigate("/srdhouse");
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
    clients,
    provideRef,
    handleMute,
    endRoom,
    blockUser,
    messages,
    sendMessage,
    localMediaStream,
  };
};
