// Tag types for the conversation tagging system

export type ConversationTag = {
  id: string;
  conversationId: string;
  tag: string;
  createdAt: string;
  updatedAt: string;
};

export type GlobalTag = {
  id: string;
  tag: string;
  createdAt: string;
};

export type ConversationGlobalTag = {
  conversationId: string;
  globalTagId: string;
};

// API response types
export type Round1TagsResponse = {
  success: boolean;
  tags?: ConversationTag[];
  error?: string;
};

export type Round2TagsResponse = {
  success: boolean;
  globalTags?: GlobalTag[];
  mappings?: ConversationGlobalTag[];
  error?: string;
};

// Widget types for the dashboard
export type Widget = {
  id: string;
  globalTagId: string;
  globalTag: string;
  conversationIds: string[];
  createdAt: string;
};

