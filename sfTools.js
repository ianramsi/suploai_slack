/**
 * sfTools.js
 *
 * Defines the OpenAI tool (function calling) schemas and their execution logic
 * for Salesforce read operations. These tools are passed to the OpenAI API so the
 * AI can decide which Salesforce operation to invoke based on user intent.
 *
 * Flow:
 *   1. OpenAI receives user message + tool definitions
 *   2. OpenAI returns tool_calls if it needs data from Salesforce
 *   3. executeTool() dispatches to the correct salesforce.js function
 *   4. Results are fed back to OpenAI for the final natural-language response
 *
 * Phase 1: Read-only (query + search). Write operations will be added in Phase 2.
 */

const { describeObject, runSOQL, runSOSL, getRecord, getActivityHistory } = require('./salesforce');

/**
 * OpenAI tool schema definitions.
 * Each entry maps to one Salesforce operation. The AI uses the name and description
 * to decide when to call a tool, and the parameters schema to construct the arguments.
 *
 * @type {Array<Object>} Array of OpenAI-compatible tool definitions
 */
const SF_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'describe_salesforce_object',
      description:
        'Fetches the field schema (field names, types, labels) for a given Salesforce object. ' +
        'Call this BEFORE constructing any SOQL query so you know which fields are available. ' +
        'Supported objects include: Contact, Lead, Opportunity, Task, Event, Project__c, Account, and others.',
      parameters: {
        type: 'object',
        properties: {
          object_name: {
            type: 'string',
            description: 'The Salesforce API name of the object to describe (e.g. "Contact", "Project__c").',
          },
        },
        required: ['object_name'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'query_records',
      description:
        'Executes a SOQL query against Salesforce and returns matching records. ' +
        'Use this when you know the exact field names and want filtered, structured results. ' +
        'Always call describe_salesforce_object first if you are unsure of the available fields.',
      parameters: {
        type: 'object',
        properties: {
          soql: {
            type: 'string',
            description:
              'A valid SOQL query string. Example: "SELECT Id, Name, Email FROM Contact WHERE Name LIKE \'%John%\' LIMIT 10"',
          },
        },
        required: ['soql'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'search_records',
      description:
        'Performs a keyword search across one or more Salesforce objects using SOSL. ' +
        'Best for finding records when you only have a name or partial keyword and do not know the exact field. ' +
        'Ask the user which object(s) to search if they have not specified.',
      parameters: {
        type: 'object',
        properties: {
          search_term: {
            type: 'string',
            description: 'The keyword or phrase to search for (e.g. "John Doe", "Project Alpha").',
          },
          object_names: {
            type: 'array',
            items: { type: 'string' },
            description:
              'List of Salesforce object API names to search within. ' +
              'Example: ["Contact", "Lead"]. Ask the user if not specified.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of records to return per object. Defaults to 10.',
          },
        },
        required: ['search_term', 'object_names'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_record_details',
      description:
        'Fetches the full details of a single Salesforce record by its Id. ' +
        'Use this after search_records or query_records returns an Id, to get more complete information.',
      parameters: {
        type: 'object',
        properties: {
          object_name: {
            type: 'string',
            description: 'The Salesforce API name of the object (e.g. "Contact", "Opportunity").',
          },
          record_id: {
            type: 'string',
            description: 'The 15 or 18-character Salesforce record Id.',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of field API names to retrieve. If omitted, Salesforce returns all readable fields.',
          },
        },
        required: ['object_name', 'record_id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_activity_history',
      description:
        'Retrieves the activity history (Tasks and Events) linked to a Salesforce record. ' +
        'Use this when a user asks about past interactions, calls, meetings, or emails related to a record.',
      parameters: {
        type: 'object',
        properties: {
          record_id: {
            type: 'string',
            description: 'The Salesforce record Id to fetch activities for.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of activities to return. Defaults to 20.',
          },
        },
        required: ['record_id'],
      },
    },
  },
];

/**
 * Dispatches an OpenAI tool call to the corresponding Salesforce function.
 * Called inside the tool-calling loop in app.js after OpenAI returns tool_calls.
 *
 * @param {string} toolName - The name of the tool as defined in SF_TOOLS (e.g. "query_records")
 * @param {Object} args - The parsed arguments object from OpenAI's tool_call
 * @returns {Promise<string>} JSON string of the tool result, to be sent back to OpenAI
 * @throws {Error} If the tool name is unknown or the underlying SF call fails
 */
async function executeTool(toolName, args) {
  switch (toolName) {
    case 'describe_salesforce_object': {
      const result = await describeObject(args.object_name);
      return JSON.stringify(result);
    }

    case 'query_records': {
      const result = await runSOQL(args.soql);
      return JSON.stringify(result);
    }

    case 'search_records': {
      const result = await runSOSL(
        args.search_term,
        args.object_names,
        args.limit || 10
      );
      return JSON.stringify(result);
    }

    case 'get_record_details': {
      const result = await getRecord(
        args.object_name,
        args.record_id,
        args.fields || []
      );
      return JSON.stringify(result);
    }

    case 'get_activity_history': {
      const result = await getActivityHistory(
        args.record_id,
        args.limit || 20
      );
      return JSON.stringify(result);
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { SF_TOOLS, executeTool };
