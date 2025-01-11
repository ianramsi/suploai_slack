const { App, LogLevel, Assistant } = require('@slack/bolt');
const { config } = require('dotenv');
const { OpenAI } = require('openai');

//import { OpenAI } from 'openai';

config();

/** Initialization */
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
});

// Model configuration
const LLM_PROVIDERS = {
  OPENAI: 'openai',
  DEEPSEEK: 'deepseekAi'
};

const DEFAULT_MODEL = LLM_PROVIDERS.DEEPSEEK;

// Initialize LLM clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize DeepSeek
const deepseekAi = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY
});


// Store user model preferences
const userModelPreferences = new Map();

// Command to allow users to switch between different LLM providers
// Usage: /set-model openai or /set-model deepseek
app.command('/set-model', async ({ command, ack, say }) => {
  await ack();
  const userId = command.user_id;
  const model = command.text.toLowerCase();
  
  // Validate if requested model exists in our supported providers
  if (Object.values(LLM_PROVIDERS).includes(model)) {
    userModelPreferences.set(userId, model);
    await say(`Model preference updated to ${model}`);
  } else {
    // Show available models if invalid model specified
    await say(`Available models: ${Object.values(LLM_PROVIDERS).join(', ')}`);
  }
});

// Enhanced LLM request handler with fallback mechanism
async function handleLLMRequest(messages, userId) {
  // Get user's preferred model or use default if not set
  const model = userModelPreferences.get(userId) || DEFAULT_MODEL;
  
  try {
    // Handle OpenAI requests
    if (model === LLM_PROVIDERS.OPENAI) {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        n: 1,
        messages,
      });
      return response.choices[0].message.content;
    } 
    // Handle DeepSeek requests
    else if (model === LLM_PROVIDERS.DEEPSEEK) {
      const response = await deepseekAi.chat.completions.create({
        model: 'deepseek-chat',
        n: 1,
        messages,
      });
      return response.choices[0].message.content;
    }
    // Fallback to default model if selected model is invalid
    // Passing null as userId prevents infinite recursion
    return handleLLMRequest(messages, null); 
  } catch (error) {
    console.error('LLM Error:', error);
    throw error;
  }
}

// Command to check which LLM model is currently active for the user
// will change to make deepseek the only  model
// Usage: /current-model
app.command('/current-model', async ({ command, ack, say }) => {
  await ack();
  const userId = command.user_id;
  // Retrieve user's current model preference or show default
  const currentModel = userModelPreferences.get(userId) || DEFAULT_MODEL;
  await say(`Your current model is: ${currentModel}`);
});

const DEFAULT_SYSTEM_CONTENT = `You're an assistant in a Slack Langit Kreasi Solusindo workspace.
Users in the workspace will ask you to help them write something or to think better about a specific topic.
You'll respond to those questions in a professional way.
When you include markdown text, convert them to Slack compatible ones.
When a prompt has Slack's special syntax like <@USER_ID> or <#CHANNEL_ID>, you must keep them as-is in your response.`;

// Assistant configuration and event handlers
const assistant = new Assistant({
  threadStarted: async ({ event, logger, say, setSuggestedPrompts, saveThreadContext }) => {
    const { context } = event.assistant_thread;

    try {
      await say('Hi, how can Suplo help?');

      await saveThreadContext();

      const prompts = [
        {
          title: 'This is a suggested prompt',
          message:
            'When a user clicks a prompt, the resulting prompt message text can be passed ' +
            'directly to your LLM for processing.\n\nAssistant, please create some helpful prompts ' +
            'I can provide to my users.',
        },
      ];

      if (context.channel_id) {
        prompts.push({
          title: 'Summarize channel',
          message: 'Assistant, please summarize the activity in this channel!',
        });
      }

      await setSuggestedPrompts({ prompts, title: 'Here are some suggested options by Suplo:' });
    } catch (e) {
      logger.error(e);
    }
  },

  threadContextChanged: async ({ logger, saveThreadContext }) => {
    try {
      await saveThreadContext();
    } catch (e) {
      logger.error(e);
    }
  },

  userMessage: async ({ client, logger, message, getThreadContext, say, setTitle, setStatus }) => {
    const { channel, thread_ts } = message;

    try {
      await setTitle(message.text);
      await setStatus('is typing Biatch!!....');

      if (message.text === 'Assistant, please summarize the activity in this channel!') {
        const threadContext = await getThreadContext();
        let channelHistory;

        try {
          channelHistory = await client.conversations.history({
            channel: threadContext.channel_id,
            limit: 50,
          });
        } catch (e) {
          if (e.data.error === 'not_in_channel') {
            await client.conversations.join({ channel: threadContext.channel_id });
            channelHistory = await client.conversations.history({
              channel: threadContext.channel_id,
              limit: 50,
            });
          } else {
            logger.error(e);
          }
        }

        let llmPrompt = `Please generate a brief summary of the following messages from Slack channel <#${threadContext.channel_id}>:`;
        for (const m of channelHistory.messages.reverse()) {
          if (m.user) llmPrompt += `\n<@${m.user}> says: ${m.text}`;
        }

        const messages = [
          { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
          { role: 'user', content: llmPrompt },
        ];

        const llmResponse = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          n: 1,
          messages,
        });

        await say({ text: llmResponse.choices[0].message.content });

        return;
      }

      const thread = await client.conversations.replies({
        channel,
        ts: thread_ts,
        oldest: thread_ts,
      });

      const userMessage = { role: 'user', content: message.text };
      const threadHistory = thread.messages.map((m) => {
        const role = m.bot_id ? 'assistant' : 'user';
        return { role, content: m.text };
      });

      const messages = [{ role: 'system', content: DEFAULT_SYSTEM_CONTENT }, ...threadHistory, userMessage];

      const llmResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        n: 1,
        messages,
      });

      await say({ text: llmResponse.choices[0].message.content });
    } catch (e) {
      logger.error(e);
      await say({ text: 'Sorry, something went wrong!' });
    }
  },
});

app.assistant(assistant);

/** Start the Bolt App */
(async () => {
  try {
    await app.start();
    app.logger.info('⚡️ Bolt app is running!');
  } catch (error) {
    app.logger.error('Failed to start the app', error);
  }
})();

//enable direct mention for summarization
app.event('app_mention', async ({ event, client, say }) => {
  if (event.text.toLowerCase().includes('summarize') || event.text.toLowerCase().includes('summary')) {
    try {
      const channelHistory = await client.conversations.history({
        channel: event.channel,
        limit: 50
      });
      
      let llmPrompt = `Please generate a brief summary of the following messages from Slack channel <#${event.channel}>:`;
      for (const m of channelHistory.messages.reverse()) {
        if (m.user) llmPrompt += `\n<@${m.user}> says: ${m.text}`;
      }

      const messages = [
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        { role: 'user', content: llmPrompt },
      ];

      const llmResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        n: 1,
        messages,
      });

      await say({ text: llmResponse.choices[0].message.content });
    } catch (error) {
      console.error(error);
    }
  } else {
    const messages = [
      { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
      { role: 'user', content: event.text }
    ];

    const llmResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      n: 1,
      messages,
    });

    await say({ text: llmResponse.choices[0].message.content });
  }
});