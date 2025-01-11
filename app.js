const { App, LogLevel, Assistant } = require('@slack/bolt');
const { config } = require('dotenv');
const { OpenAI } = require('openai');

//import { OpenAI } from 'openai';

config();

/** Initialization Slack*/
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.DEBUG,
});

// Initialize Openai
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize DeepSeek
const deepseekAi = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY
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

        const llmResponse = await deepseekAi.chat.completions.create({
          model: 'deepseek-chat',
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

      const llmResponse = await deepseekAi.chat.completions.create({
        model: 'deepseek-chat',
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
    app.logger.info('⚡️ Suplo app is running!');
  } catch (error) {
    app.logger.error('Failed to start Suplo', error);
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

      const llmResponse = await deepseekAi.chat.completions.create({
        model: 'deepseek-chat',
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

    const llmResponse = await deepseekAi.chat.completions.create({
      model: 'deepseek-chat',
      n: 1,
      messages,
    });

    await say({ text: llmResponse.choices[0].message.content });
  }
});