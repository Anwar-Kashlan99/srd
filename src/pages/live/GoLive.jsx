import React, {
  Fragment,
  useCallback,
  useEffect,
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
import { useWebRTC } from "../../hooks/useWebRTCVideo2";
import { useWebRTCVideo } from "../../hooks/useWebRTCVideo";
import ChatRoomLive from "../../components/ChatRoomLive";

const GoLive = () => {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const userDetails = useSelector((state) => state.user.userDetails);

  const [isMuted, setMuted] = useState(true);

  const isMobile = useMediaQuery("(max-width: 768px)");
  const isNonMobile = useMediaQuery("(min-width: 1200px)");
  const isBigScreen = useMediaQuery("(min-width: 1800px)");

  // Fetch room details
  const {
    data: room,
    isError: roomError,
    isLoading: roomLoading,
  } = useGetRoomQuery(roomId);

  // WebRTC hooks
  const {
    clients,
    provideRef,
    handleMute,
    endRoom,
    blockUser,
    messages,
    sendMessage,
    localMediaStream,
  } = useWebRTCVideo(roomId, userDetails);

  // Determine if the current user is the streamer or a viewer
  const isStreamer = clients.length && clients[0]._id === userDetails._id;
  const currentUser = clients.find((client) => client._id === userDetails._id);
  const streamerID = clients[0]?._id;

  // Function to handle mute/unmute for streamer
  const toggleMute = () => {
    setMuted(!isMuted);
    handleMute(isMuted, userDetails._id); // Toggle mute for the streamer
  };

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
          <video
            id={`video-${streamerID}`}
            ref={(instance) => provideRef(instance, streamerID)}
            autoPlay
            playsInline
            muted={streamerID === userDetails._id} // Mute self for streamer
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
          {streamerID === userDetails._id && (
            <IconButton
              onClick={toggleMute}
              sx={{
                position: "absolute",
                bottom: 10,
                right: 10,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                color: "white",
              }}
            >
              {isMuted ? (
                <MicOutlined sx={{ fontSize: "28px" }} />
              ) : (
                <MicOffOutlined sx={{ fontSize: "28px" }} />
              )}
            </IconButton>
          )}
        </Box>
        {/*chat */}
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
          <ChatRoomLive
            reverse={true}
            messages={messages}
            sendMessage={sendMessage}
            currentUserId={currentUser}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default GoLive;
