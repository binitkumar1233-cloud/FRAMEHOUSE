import { io, Socket } from "socket.io-client";
import { API_ORIGIN } from "./api";

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL?.replace(/\/+$/, "") ||
  API_ORIGIN ||
  (import.meta.env.DEV ? "http://localhost:5000" : window.location.origin);

/**
 * Creates a dedicated socket for one meeting session.
 * The token is read on every (re)connect so a refreshed login is picked up.
 */
export const createMeetingSocket = (): Socket => {
  if (!localStorage.getItem("token")) {
    throw new Error("Please sign in to join meetings.");
  }

  return io(SOCKET_URL, {
    auth: (callback) => callback({ token: localStorage.getItem("token") }),
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
};
