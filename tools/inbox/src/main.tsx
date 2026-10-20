import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Inbox } from "./inbox";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Inbox />
  </StrictMode>,
);
