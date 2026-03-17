import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import App from "./App";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container not found");
}

const theme = createTheme({
  primaryColor: "gray",
  defaultRadius: "md",
});

createRoot(container).render(
  <StrictMode>
    <MantineProvider forceColorScheme="dark" theme={theme}>
      <ModalsProvider>
        <Notifications position="top-right" />
        <App />
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
);
