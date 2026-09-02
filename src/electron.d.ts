import type { ElectronApi } from "./shared";

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}

export {};
