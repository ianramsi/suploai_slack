const { App, LogLevel, Assistant } = require('@slack/bolt');
const { config } = require('dotenv');
const { OpenAI } = require('openai');
// Removed unused ESM import that caused Jest compatibility issues
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

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
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const DEFAULT_SYSTEM_CONTENT = `You are Suplo, an assistant in a Slack Langit Kreasi Solusindo workspace.
Users in the workspace will ask you to help them write something or to think better about a specific topic.
You'll respond to those questions in a professional way unless explicitly requested otherwise.
When you include markdown text, convert them to Slack compatible ones.
When a prompt has Slack's special syntax like <@USER_ID> or <#CHANNEL_ID>, you must keep them as-is in your response.
Avoid starting responses with greetings unless explicitly requested by the user.`;

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
      await setStatus('is typing....biatch');

      //add identity check
      const identityQuestions = ['who are you', 'siapa kamu','what is your name', 'what is your identity', 'what are you?'];
      if (identityQuestions.some(q => message.text.toLowerCase().includes(q))) {
        await say("I'm Suplo, LKS Assistant (Idiot) ready to serve all LKS Members. Suplo is The Man, The Myth, The LEGEND!!");
        return;

      }
      const thread = await client.conversations.replies({
        channel,
        ts: thread_ts,
        oldest: thread_ts,
      });

      // Filter out the initial greeting from thread history
      const threadHistory = thread.messages
        .filter(m => m.text !== 'Hi, sorry Suplo lagi ngehang....')
        .slice(-10) //keep only the last 10 of message
        .map(m => ({
          role: m.bot_id ? 'assistant' : 'user',
          content: m.text
        }));

      const messages = [
        { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
        ...threadHistory,
        { role: 'user', content: message.text }
      ];

      //logger.debug('Sending messages to LLM:', JSON.stringify(messages, null, 2));

      const llmResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        n: 1,
        messages,
        temperature: 0.7 // Adding temperature for more varied responses
      });

      const responseContent = llmResponse.choices[0].message.content;
      await say({ text: responseContent });
    } catch (e) {
      logger.error('Error processing user message:', e);
      await say({ text: 'Something unexpected happened while processing your request' });
    }
  },});

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

// Enable direct mention for summarization
app.event('app_mention', async ({ event, client, say }) => {
  if (event.text.toLowerCase().includes('summarize') || event.text.toLowerCase().includes('summary')) {
    try {
      const channelHistory = await client.conversations.history({
        channel: event.channel,
        limit: 50,
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
        model: 'gpt-4o-mini',
        n: 1,
        messages,
      });

      const responseContent = llmResponse.choices[0].message.content;
      await say({ text: responseContent });
    } catch (error) {
      console.error(error);
    }
  } else {
    const messages = [
      { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
      { role: 'user', content: event.text },
    ];

    const llmResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',//change from 'gpt-3.5-turbo',
      n: 1,
      messages,
    });

    const responseContent = llmResponse.choices[0].message.content;
    await say({ text: responseContent });
  }
});

//function to download file from slack
async function downloadFile(url, token) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }
  });
  return response.data;
}

//function to process document based on type
async function processDocument(fileData, fileType) {
  switch(fileType) {
    case 'pdf': const pdfData = await pdfParse(fileData);
      return pdfData.text;
    case 'docx': const docxResult = await mammoth.extractRawText({ buffer: fileData});
      return docxResult.value;
    default: throw new Error('Sorry Document type not supported');
  }
}

// add event listener to handle file uploads
app.event('file_shared', async ({event, client, say}) => {
  try {
    const fileInfo = await client.files.info({file: event.file_id});
    const fileType = fileInfo.file.filetype.toLowerCase();

    //check if fie type is supported
    if (fileType !== 'pdf' && fileType !== 'docx') {
      await say({ text: 'Sorry, Suplo only supports PDF and DOCX files at the moment.' });
      return;
    }

    const fileData = await downloadFile(fileInfo.file.url_private);
    const extractedText = await processDocument(fileData, fileType);

    const messages = [
      { role: 'system', content: DEFAULT_SYSTEM_CONTENT },
      { role: 'user', content: `Analyze this document content: ${extractedText}` }
    ];
    const llmResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.7
    });

    await say({ text: llmResponse.choices[0].message.content });

  } catch (error) {
    if (error.message == 'Sorry Document type not supported') {
      await say({ text: 'Sorry, Suplo only supports PDF and DOCX files at the moment.' });
    } else {
      await say ({ text: 'Something unexpected happened while processing your request' });
      console.error('Document processing error --> ',error);
      
    }  
  }
});
