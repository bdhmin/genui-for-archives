import Anthropic from "@anthropic-ai/sdk";

type TitleInput = {
  userMessage: string;
  assistantMessage?: string;
};

function fallbackTitle(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "New conversation";
  return trimmed.slice(0, 50);
}

export async function generateConversationTitle({
  userMessage,
  assistantMessage = "",
}: TitleInput): Promise<string> {
  const baseText = userMessage || assistantMessage || "New conversation";

  if (!process.env.CLAUDE_API_KEY) {
    return fallbackTitle(baseText);
  }

  const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 32,
      system: "Create a 2-3 word title for this conversation. Be brief and direct. No quotes, no punctuation. Respond with only the title, nothing else.",
      messages: [
        {
          role: "user",
          content: `User: ${userMessage.slice(0, 400)}\nAssistant: ${assistantMessage.slice(0, 400)}`,
        },
      ],
    });

    const textBlock = response.content.find(block => block.type === "text");
    const title = textBlock?.type === "text" ? textBlock.text.trim() : null;
    return title && title.length > 0 ? title : fallbackTitle(baseText);
  } catch (error) {
    console.error("Title generation failed", error);
    return fallbackTitle(baseText);
  }
}
