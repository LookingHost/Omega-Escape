import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// remove the instant boot splash once the app has mounted
requestAnimationFrame(() => {
  const boot = document.getElementById("boot");
  if (boot) {
    boot.style.transition = "opacity 0.3s";
    boot.style.opacity = "0";
    setTimeout(() => boot.remove(), 320);
  }
});
