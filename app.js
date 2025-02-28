const { App, LogLevel, Assistant } = require('@slack/bolt');
const { WebClient } = require('@slack/web-api');
const { config } = require('dotenv');
const { OpenAI } = require('openai');
// Removed unused ESM import that caused Jest compatibility issues
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fetch = require('node-fetch');

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
// const deepseekAi = new OpenAI({
//   baseURL: 'https://api.deepseek.com/v1',
//   apiKey: process.env.DEEPSEEK_API_KEY,
// });

const userClient = new WebClient(process.env.SLACK_USER_TOKEN);
const sfUrl = 'https://langitkreasisolusindo--devlks.sandbox.my.salesforce-setup.com';

const formatTimestamp = (timestamp) => {
  const date = new Date((timestamp + 7 * 60 * 60) * 1000); // Adjust for timezone
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are zero-based
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const formatDate = (dateStr) => {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are zero-based
  const day = String(date.getDate()).padStart(2, "0");
  return `${day}/${month}/${year}`;
};

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

      // logger.debug('Sending messages to LLM:', JSON.stringify(messages, null, 2));

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

app.command('/timesheet-lks', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
        trigger_id: body.trigger_id,
        view: {
            type: 'modal',
            callback_id: 'timesheet_modal',
            title: {
                type: 'plain_text',
                text: 'Submit TimeSheet'
            },
            submit: {
                type: 'plain_text',
                text: 'Submit'
            },
            close: {
                type: 'plain_text',
                text: 'Cancel'
            },
            blocks: [
                {
                    type: 'input',
                    block_id: 'start_datetime_block',
                    element: {
                        type: 'datetimepicker',
                        action_id: 'start_datetime',
                        initial_date_time: Math.floor(Date.now() / 1000) // Set initial time to current time in seconds
                    },
                    label: {
                        type: 'plain_text',
                        text: 'Start datetime'
                    }
                },
                {
                    type: 'input',
                    block_id: 'end_datetime_block',
                    element: {
                        type: 'datetimepicker',
                        action_id: 'end_datetime',
                        initial_date_time: Math.floor(Date.now() / 1000) // Set initial time to current time in seconds
                    },
                    label: {
                        type: 'plain_text',
                        text: 'End datetime'
                    }
                },
                {
                    type: 'input',
                    block_id: 'work_mode_block',
                    element: {
                        type: 'static_select',
                        action_id: 'work_mode',
                        placeholder: {
                            type: 'plain_text',
                            text: 'Select work mode'
                        },
                        options: [
                            {
                                text: {
                                    type: 'plain_text',
                                    text: 'WFO'
                                },
                                value: 'WFO'
                            },
                            {
                                text: {
                                    type: 'plain_text',
                                    text: 'WFA'
                                },
                                value: 'WFA'
                            },
                            {
                                text: {
                                    type: 'plain_text',
                                    text: 'Hybrid'
                                },
                                value: 'Hybrid'
                            }
                        ]
                    },
                    label: {
                        type: 'plain_text',
                        text: 'Work Mode'
                    }
                }
            ]
        }
    });
  } catch (error) {
    console.error('Error opening timesheet modal:', error);
    console.error(JSON.stringify(error, null, 2));
  }
});

app.view('timesheet_modal', async ({ ack, body, view, client }) => {
  await ack();
  try {
    const startDatetime = view.state.values.start_datetime_block.start_datetime.selected_date_time;
    const endDatetime = view.state.values.end_datetime_block.end_datetime.selected_date_time;
    const workMode = view.state.values.work_mode_block.work_mode.selected_option.value;

    // Proses data yang diterima

    // Lanjutkan dengan fungsi yang Anda inginkan setelah submit
    const userId = body.user.id;
    // Dapatkan informasi pengguna
    const userInfo = await client.users.info({
        user: body.user.id,
    });

    // Ambil email dari profil pengguna
    const email = userInfo.user.profile?.email || "unknown@example.com";

    const timeSheetChannelId = process.env.SLACK_TIMESHEET_CHANNEL;

    const updatedMsg = `<@${userId}> submitted the following TimeSheet: \n<!date^${startDatetime}^{date} at {time}|${startDatetime}> - <!date^${endDatetime}^{date} at {time}|${endDatetime}>\nWork Mode: ${workMode}`;

    await client.chat.postMessage({
        channel: timeSheetChannelId,
        text: updatedMsg,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: updatedMsg,
                },
            },
            {
                type: "actions",
                block_id: `timesheet_actions`,
                elements: [
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "Approve",
                        },
                        action_id: "approve_request",
                        style: "primary",
                        value: JSON.stringify({
                            email,
                            startDatetime,
                            endDatetime,
                            workMode,
                            userId,
                        }),
                    },
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "Reject",
                        },
                        action_id: "reject_request",
                        style: "danger",
                        value: JSON.stringify({
                            email,
                            startDatetime,
                            endDatetime,
                            workMode,
                            userId,
                        }),
                    },
                ],
            },
        ],
    });
  } catch (error) {
    console.error('Error submitting timesheet:', error);
    console.error(JSON.stringify(error, null, 2));
    await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Sorry, there was an error submitting your timesheet.'
    });
  }
});

app.action('approve_request', async ({ ack, body, client, action }) => {
  await ack(); // Acknowledge the action first
  try {
    const metadata = JSON.parse(action.value);
    const { email, startDatetime, endDatetime, workMode, userId } = metadata;
    
    const startDate = formatTimestamp(startDatetime);
    const endDate = formatTimestamp(endDatetime);

    // Proses pengiriman data ke Salesforce
    // Panggil fungsi yang diinginkan
    await handleTimesheetApproval({
        client,
        userId,
        email,
        startDate,
        endDate,
        workMode
    });

    // Kirim konfirmasi ke pengguna
    await client.chat.postMessage({
        channel: userId,
        text: `Your timesheet has been :white_check_mark: approved: \n<!date^${startDatetime}^{date} at {time}|${startDatetime}> - <!date^${endDatetime}^{date} at {time}|${endDatetime}>\nWork Mode: ${workMode}`,
    });
    
    const approverId = body.user.id;

    // Update pesan asli untuk menghapus tombol
    await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `Timesheet submitted by <@${userId}> : \n(<!date^${startDatetime}^{date} at {time}|${startDatetime}> - <!date^${endDatetime}^{date} at {time}|${endDatetime}>)\nWork Mode: ${workMode}`,
                },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `:white_check_mark: Approved by <@${approverId}>`,
                },
              ],
            },
        ],
    });

    let statusText = "Office";
    let statusEmoji = ":office:";

    if (workMode == "Hybrid") {
      statusText = "Commuting";
      statusEmoji = ":bus:";
    } else if (workMode == "WFA") {
      statusText = "Working remotely";
      statusEmoji = ":house_with_garden:";
    }

    // Update status pengguna
    await userClient.users.profile.set({
        user: userId,
        profile: {
            status_text: statusText,
            status_emoji: statusEmoji,
            status_expiration: endDatetime, // Opsional: hapus status otomatis
        }
    });

  } catch (error) {
    console.error('Error approving timesheet:', error);
    await client.chat.postMessage({
        channel: userId,
        text: `❌ Error approving your timesheet: ${error.message}`,
    });
  }
});

app.action('reject_request', async ({ ack, body, client, action }) => {
  await ack(); // Acknowledge the action first
  try {
    const metadata = JSON.parse(action.value);
    const { email, startDatetime, endDatetime, workMode, userId } = metadata;

    // Kirim notifikasi penolakan ke pengguna
    await client.chat.postMessage({
        channel: userId,
        text: `Your timesheet has been :x: rejected: \n<!date^${startDatetime}^{date} at {time}|${startDatetime}> - <!date^${endDatetime}^{date} at {time}|${endDatetime}>\nWork Mode: ${workMode}`,
    });

    const approverId = body.user.id;

    // Update pesan asli untuk menghapus tombol
    await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `Timesheet submitted by <@${userId}> : \n(<!date^${startDatetime}^{date} at {time}|${startDatetime}> - <!date^${endDatetime}^{date} at {time}|${endDatetime}>)\nWork Mode: ${workMode}`,
                },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `:x: Rejected by <@${approverId}>`,
                },
              ],
            },
        ],
    });

  } catch (error) {
    console.error('Error rejecting timesheet:', error);
    await client.chat.postMessage({
        channel: userId,
        text: `❌ Error rejecting your timesheet: ${error.message}`,
    });
  }
});

app.command('/leaverequest-lks', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
        trigger_id: body.trigger_id,
        view: {
            type: 'modal',
            callback_id: 'leaverequest_modal',
            title: {
                type: 'plain_text',
                text: 'Submit Leave Request'
            },
            submit: {
                type: 'plain_text',
                text: 'Submit'
            },
            close: {
                type: 'plain_text',
                text: 'Cancel'
            },
            blocks: [
                {
                    type: 'input',
                    block_id: 'title_block',
                    label: {
                        type: 'plain_text',
                        text: 'Title'
                    },
                    element: {
                        type: 'plain_text_input',
                        action_id: 'title',
                        placeholder: {
                        type: 'plain_text',
                        text: 'Enter post title'
                        }
                    }
                },
                {
                    type: 'input',
                    block_id: 'start_date_block',
                    label: {
                        type: 'plain_text',
                        text: 'Start Date'
                    },
                    element: {
                        type: 'datepicker',
                        action_id: 'start_date',
                        initial_date: new Date().toISOString().split('T')[0]
                    }
                },
                {
                    type: 'input',
                    block_id: 'end_date_block',
                    label: {
                        type: 'plain_text',
                        text: 'End Date'
                    },
                    element: {
                        type: 'datepicker',
                        action_id: 'end_date',
                        initial_date: new Date().toISOString().split('T')[0]
                    }
                },
                {
                    type: 'input',
                    block_id: 'note_block',
                    label: {
                        type: 'plain_text',
                        text: 'Note'
                    },
                    element: {
                        type: 'plain_text_input',
                        action_id: 'note',
                        multiline: true,
                        placeholder: {
                        type: 'plain_text',
                        text: 'Enter additional notes'
                        }
                    }
                }
            ]
        }
    });
  } catch (error) {
    console.error('Error opening Leave Request modal:', error);
    console.error(JSON.stringify(error, null, 2));
  }
});

app.view('leaverequest_modal', async ({ ack, body, view, client }) => {
  await ack();
  try {
    const title = view.state.values.title_block.title.value;
    const startDate = view.state.values.start_date_block.start_date.selected_date;
    const endDate = view.state.values.end_date_block.end_date.selected_date;
    const note = view.state.values.note_block.note.value;

    // Lanjutkan dengan fungsi yang Anda inginkan setelah submit
    const userId = body.user.id;
    // Dapatkan informasi pengguna
    const userInfo = await client.users.info({
        user: body.user.id,
    });

    // Ambil email dari profil pengguna
    const email = userInfo.user.profile?.email || "unknown@example.com";

    const timeSheetChannelId = process.env.SLACK_TIMESHEET_CHANNEL;

    const updatedMsg = `<@${userId}> submitted the following Leave Request: \nTitle : ${title}\n${startDate} - ${endDate}\nNote: ${note}`;

    await client.chat.postMessage({
        channel: timeSheetChannelId,
        text: updatedMsg,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: updatedMsg,
                },
            },
            {
                type: "actions",
                block_id: `leaverequest_actions`,
                elements: [
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "Approve",
                        },
                        action_id: "approve_request_lr",
                        style: "primary",
                        value: JSON.stringify({
                            email,
                            startDate,
                            endDate,
                            title,
                            note,
                            userId,
                        }),
                    },
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "Reject",
                        },
                        action_id: "reject_request_lr",
                        style: "danger",
                        value: JSON.stringify({
                            email,
                            startDate,
                            endDate,
                            title,
                            note,
                            userId,
                        }),
                    },
                ],
            },
        ],
    });
  } catch (error) {
    console.error('Error submitting Leave Request:', error);
    console.error(JSON.stringify(error, null, 2));
    await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Sorry, there was an error submitting your Leave Request.'
    });
  }
});

app.action('approve_request_lr', async ({ ack, body, client, action }) => {
  await ack(); // Acknowledge the action first
  try {
    const metadata = JSON.parse(action.value);
    const { email, startDate, endDate, title, note, userId } = metadata;
    
    const startDateFormatted = formatDate(startDate);
    const endDateFormatted = formatDate(endDate);

    // Proses pengiriman data ke Salesforce
    // Panggil fungsi yang diinginkan
    await handleLeaveRequestApproval({
        client,
        userId,
        email,
        startDateFormatted,
        endDateFormatted,
        title,
        note
    });

    // Kirim konfirmasi ke pengguna
    await client.chat.postMessage({
        channel: userId,
        text: `Your Leave Request has been :white_check_mark: approved: \nTitle : ${title}\n${startDate} - ${endDate}\nNote: ${note}`,
    });

    const approverId = body.user.id;

    // Update pesan asli untuk menghapus tombol
    await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `Leave Request submitted by <@${userId}> : \nTitle : ${title}\n${startDate} - ${endDate}\nNote: ${note}`,
                },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `:white_check_mark: Approved by <@${approverId}>`,
                },
              ],
            },
        ],
    });

  } catch (error) {
    console.error('Error approving Leave Request:', error);
    await client.chat.postMessage({
        channel: userId,
        text: `❌ Error approving your Leave Request: ${error.message}`,
    });
  }
});

app.action('reject_request_lr', async ({ ack, body, client, action }) => {
  await ack(); // Acknowledge the action first
  try {
    const metadata = JSON.parse(action.value);
    const { email, startDate, endDate, title, note, userId } = metadata;

    // Kirim notifikasi penolakan ke pengguna
    await client.chat.postMessage({
        channel: userId,
        text: `Your Leave Request has been :x: rejected: \nTitle : ${title}\n${startDate} - ${endDate}\nNote: ${note}`,
    });

    const approverId = body.user.id;

    // Update pesan asli untuk menghapus tombol
    await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `Leave Request submitted by <@${userId}> : \nTitle : ${title}\n${startDate} - ${endDate}\nNote: ${note}`,
                },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `:x: Rejected by <@${approverId}>`,
                },
              ],
            },
        ],
    });

  } catch (error) {
    console.error('Error rejecting Leave Request:', error);
    await client.chat.postMessage({
        channel: userId,
        text: `❌ Error rejecting your Leave Request: ${error.message}`,
    });
  }
});

async function getSalesforceToken() {
  const sf_token_url = sfUrl+"/services/oauth2/token?grant_type=password&client_id="+process.env.SALESFORCE_CLIENT_ID+"&client_secret="+process.env.SALESFORCE_CLIENT_SECRET+"&username="+process.env.SALESFORCE_USER_NAME+"&password="+process.env.SALESFORCE_USER_PASS
  const salesforceResponse = await fetch(sf_token_url, {
    method: "POST",
  });

  if (!salesforceResponse.ok) {
    throw new Error(`Salesforce token error: ${salesforceResponse.statusText}`);
  }

  const salesforceTokenData = await salesforceResponse.json();
  return salesforceTokenData.access_token;
}

async function handleTimesheetApproval({ client, userId, email, startDate, endDate, workMode }) {
  try {
    const salesforceApiUrl = sfUrl+"/services/apexrest/time-sheet/v1.0/Submit"; // Ganti dengan URL API Salesforce yang sesuai
    
    const accessToken = await getSalesforceToken();

    const postData = {
        Email: email,
        WorkStart: startDate,
        WorkEnd: endDate,
        WorkMode: workMode,
    };

    const apiResponse = await fetch(salesforceApiUrl, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(postData),
    });

    if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        throw new Error(`Salesforce email: ${email}, API Error: ${errorText}`);
    }

  } catch (error) {
    console.error('Error handling timesheet approval:', error);
    await client.chat.postMessage({
        channel: userId,
        text: `❌ Error processing your timesheet: ${error.message}`
    });
  }
}

async function handleLeaveRequestApproval({ client, userId, email, startDateFormatted, endDateFormatted, title, note }) {
  try {
    const salesforceApiUrl = sfUrl+"/services/apexrest/leave-request/v1.0/Submit"; // Ganti dengan URL API Salesforce yang sesuai
    
    const accessToken = await getSalesforceToken();

    const postData = {
        Email: email,
        Title: title,
        Note: note,
        StartDate: startDateFormatted,
        EndDate: endDateFormatted,
    };

    const apiResponse = await fetch(salesforceApiUrl, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(postData),
    });

    if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        throw new Error(`Salesforce email: ${email}, API Error: ${errorText}`);
    }

  } catch (error) {
    console.error('Error handling Leave Request approval:', error);
    await client.chat.postMessage({
        channel: userId,
        text: `❌ Error processing your Leave Request: ${error.message}`
    });
  }
}