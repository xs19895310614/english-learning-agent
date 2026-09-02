import { ipcMain } from "electron";
import { lookupCollins, openCollinsWindow } from "./collins";
import { enrichDictionary, lookupDictionary } from "./dictionary";
import { sendChatMessage, testDeepSeekConnection } from "./deepseek";
import {
  createConversation,
  createStudyItem,
  deleteConversation,
  deleteStudyItem,
  getAppSettings,
  getConversationMessages,
  listConversations,
  listStudyItems,
  saveAppSettings,
  updateStudyItem,
} from "./store";

export function registerIpcHandlers() {
  ipcMain.handle("chat.send", async (_event, input) => {
    return sendChatMessage(input);
  });

  ipcMain.handle("chat.getHistory", async (_event, conversationId: string) => {
    return getConversationMessages(conversationId);
  });

  ipcMain.handle("chat.conversation", async () => {
    return createConversation();
  });

  ipcMain.handle("chat.list", async () => {
    return listConversations();
  });

  ipcMain.handle("chat.delete", async (_event, conversationId: string) => {
    return deleteConversation(conversationId);
  });

  ipcMain.handle("dictionary.lookup", async (_event, input) => {
    return lookupDictionary(input);
  });

  ipcMain.handle("dictionary.enrich", async (_event, input) => {
    return enrichDictionary(input);
  });

  ipcMain.handle("dictionary.openCollins", async (_event, query?: string) => {
    return openCollinsWindow(query);
  });

  ipcMain.handle("study.list", async () => {
    return listStudyItems();
  });

  ipcMain.handle("study.create", async (_event, input) => {
    return createStudyItem(input);
  });

  ipcMain.handle("study.update", async (_event, input) => {
    return updateStudyItem(input);
  });

  ipcMain.handle("study.delete", async (_event, id: string) => {
    return deleteStudyItem(id);
  });

  ipcMain.handle("settings.get", async () => {
    return getAppSettings();
  });

  ipcMain.handle("settings.save", async (_event, input) => {
    const { apiKey, ...settings } = input ?? {};
    return saveAppSettings(settings, apiKey);
  });

  ipcMain.handle("settings.testConnection", async () => {
    return testDeepSeekConnection();
  });
}
