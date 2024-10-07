import React, {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Box,
  useMediaQuery,
  Input,
  IconButton,
  Avatar,
  Typography,
} from "@mui/material";
import EmojiPicker from "emoji-picker-react";
import {
  Add,
  EmojiEmotionsOutlined,
  MicOffOutlined,
  MicOutlined,
  Send,
  Share,
} from "@mui/icons-material";
import toast, { Toaster } from "react-hot-toast";
import ChatRoom from "../../components/ChatRoom";
import { SharePopup } from "../../components/SharePopup";
import { useNavigate, useParams } from "react-router-dom";
import { useGetRoomQuery } from "../../store/srdClubSlice";
import { useSelector } from "react-redux";

import ChatRoomLive from "../../components/ChatRoomLive";
import { useWebRTCVideo } from "../../hooks/useWebRTCVideo";

const GoLive = () => {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const userDetails = useSelector((state) => state.user.userDetails);

  const [isMuted, setMuted] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const isMobile = useMediaQuery("(max-width: 768px)");
  const isNonMobile = useMediaQuery("(min-width: 1200px)");
  const isBigScreen = useMediaQuery("(min-width: 1800px)");
  // const currentUser =
  //   streamer?._id === userDetails._id
  //     ? streamer
  //     : viewers.find((v) => v._id === userDetails._id);

  // Fetch room details
  const {
    data: room,
    isError: roomError,
    isLoading: roomLoading,
  } = useGetRoomQuery(roomId);

  // WebRTC hooks

  const { clients, localMediaStream, remoteStreams } = useWebRTCVideo(
    roomId,
    userDetails,
    isAdmin
  );

  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({});

  const currentUser = clients?.find((client) => client._id === userDetails._id);

  useEffect(() => {
    if (currentUser && currentUser.role === "admin") {
      setIsAdmin(true);
    }
  }, [clients, userDetails]);

  // Determine if the current user is the streamer or a viewer
  // const isStreamer = streamer && streamer?._id === userDetails?._id;
  // const streamerID = streamer?._id;

  // Function to handle mute/unmute for streamer
  // const toggleMute = () => {
  //   setMuted(!isMuted);
  //   handleMute(isMuted, userDetails._id); // Toggle mute for the streamer
  // };

  useEffect(() => {
    if (localVideoRef.current && localMediaStream.current) {
      localVideoRef.current.srcObject = localMediaStream.current;
    }

    clients?.forEach((client) => {
      if (remoteStreams.current[client._id]) {
        if (!remoteVideoRefs.current[client._id]) {
          remoteVideoRefs.current[client._id] = React.createRef();
        }
        remoteVideoRefs.current[client._id].current.srcObject =
          remoteStreams.current[client._id];
      }
    });
  }, [clients, localMediaStream, remoteStreams]);

  return (
    <Box
      sx={{ minHeight: "calc(100vh - 56px)", padding: isMobile ? "" : "1rem" }}
    >
      <Toaster position="top-center" reverseOrder={false} />

      {/* Video Stream */}
      <Box
        sx={{
          padding: isMobile ? "" : "1rem 0.5rem",
          m: isMobile ? "0rem auto" : "5rem auto 1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "70px",
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: isBigScreen
              ? "725px"
              : isMobile
              ? "calc(100vh - 56px)"
              : "625px",
            borderRadius: isMobile ? "0" : "50px",
            overflow: "hidden",
            backgroundColor: "#fff",
            boxShadow: "2px 4px 7px #707070",
          }}
        >
          <div>
            {isAdmin && (
              <div>
                <h1>You're Streaming</h1>
                <video autoPlay ref={localVideoRef} muted controls />
              </div>
            )}

            <h2>Audience:</h2>
            <div>
              {clients?.map((client) => (
                <div key={client._id}>
                  <h3>{client.username}</h3>
                  <video
                    autoPlay
                    ref={remoteVideoRefs.current[client._id]}
                    controls
                  />
                </div>
              ))}
            </div>
          </div>
        </Box>
        {/*chat */}
        {!isMobile && (
          <Box
            sx={{
              width: "500px",
              borderRadius: "30px",
              backgroundColor: "#fff",
              boxShadow: "2px 4px 7px #707070",
              p: "1rem",
              height: isBigScreen
                ? "700px"
                : isMobile
                ? "calc(100vh - 56px)"
                : "600px",
            }}
          >
            {/* <ChatRoomLive
              reverse={true}
              messages={messages}
              sendMessage={sendMessage}
              currentUserId={currentUser}
            /> */}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default GoLive;
