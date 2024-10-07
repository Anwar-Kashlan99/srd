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
import { useWebRTCVideo } from "../../hooks/useWebRTCVideo";
import ChatRoomLive from "../../components/ChatRoomLive";

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
  const {
    streamer,
    viewers,
    videoRef,
    provideRef,
    handleMute,
    endRoom,
    blockUser,
    messages,
    sendMessage,
    localVideoRef,
    remoteVideoRef,
  } = useWebRTCVideo(roomId, userDetails);
  useLayoutEffect(() => {
    if (remoteVideoRef.current) {
      console.log("Video element available");
    } else {
      console.log("Video element not ready");
    }
  }, [remoteVideoRef]);

  // Determine if the current user is the streamer or a viewer
  const isStreamer = streamer && streamer?._id === userDetails?._id;
  useEffect(() => {
    if (!isStreamer && remoteVideoRef.current) {
      remoteVideoRef.current.oncanplay = () => remoteVideoRef.current.play();
    }
  }, [remoteVideoRef, isStreamer]);

  const streamerID = streamer?._id;

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
          {isStreamer ? (
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={{ width: "100%", height: "auto" }} // Optional styles
              muted={false} // Ensure it's not muted for viewers
            />
          )}
          {isStreamer && (
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
