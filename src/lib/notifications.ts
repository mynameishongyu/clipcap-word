import { notifications } from "@mantine/notifications";

const DEFAULT_AUTO_CLOSE_MS = 3000;

export function showSuccessNotification(title: string, message: string) {
  notifications.show({
    title,
    message,
    color: "green",
    autoClose: DEFAULT_AUTO_CLOSE_MS,
  });
}

export function showErrorNotification(title: string, message: string) {
  notifications.show({
    title,
    message,
    color: "red",
    autoClose: 4000,
  });
}
