import React from "react";
import { createRoot } from "react-dom/client";
import FarmModel from "./FarmModel.jsx";
import "./main.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <FarmModel />
  </React.StrictMode>
);
