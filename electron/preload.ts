import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  ChatResponse,
  Conversation,
  ConversationMessage,
  CreateStudyItemInput,
  ElectronApi,
  LookupResult,
  StudyItem,
  UpdateStudyItemInput,
} from "../src/shared";

const api: ElectronApi = {
  chat: {
    send: (input) => ipcRenderer.invoke("chat.send", input) as Promise<ChatResponse>,
    history: (conversationId) =>
      ipcRenderer.invoke("chat.getHistory", conversationId) as Promise<ConversationMessage[]>,
    conversation: () => ipcRenderer.invoke("chat.conversation") as Promise<Conversation>,
    list: () => ipcRenderer.invoke("chat.list") as Promise<Conversation[]>,
    delete: (conversationId) => ipcRenderer.invoke("chat.delete", conversationId) as Promise<void>,
  },
  dictionary: {
    lookup: (input) => ipcRenderer.invoke("dictionary.lookup", input) as Promise<LookupResult>,
    enrich: (input) => ipcRenderer.invoke("dictionary.enrich", input) as Promise<LookupResult>,
    openCollins: (query?: string) => ipcRenderer.invoke("dictionary.openCollins", query) as Promise<void>,
  },
  study: {
    list: () => ipcRenderer.invoke("study.list") as Promise<StudyItem[]>,
    create: (input: CreateStudyItemInput) =>
      ipcRenderer.invoke("study.create", input) as Promise<StudyItem>,
    update: (input: UpdateStudyItemInput) =>
      ipcRenderer.invoke("study.update", input) as Promise<StudyItem>,
    delete: (id: string) => ipcRenderer.invoke("study.delete", id) as Promise<void>,
  },
  settings: {
    get: () => ipcRenderer.invoke("settings.get") as Promise<AppSettings>,
    save: (input) => ipcRenderer.invoke("settings.save", input) as Promise<AppSettings>,
    testConnection: () =>
      ipcRenderer.invoke("settings.testConnection") as Promise<{ ok: boolean; message: string }>,
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
