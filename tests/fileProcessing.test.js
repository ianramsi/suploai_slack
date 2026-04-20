const { downloadFile, processDocument } = require('../app.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Mock axios to prevent actual HTTP requests during testing
jest.mock('axios');

// Mock Slack Bolt.js components to isolate document processing tests
jest.mock('@slack/bolt', () => ({
  // Mock App constructor and methods used in app.js
  App: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    assistant: jest.fn(),
    logger: {
      info: jest.fn(),
      error: jest.fn()
    }
  })),
  // Mock logging level enum
  LogLevel: { DEBUG: 'debug' },
  // Mock Assistant class constructor
  Assistant: jest.fn()
}));

// Setup test environment variables
// These are required to prevent runtime errors when initializing app components
process.env.SLACK_BOT_TOKEN = 'test-token';
process.env.SLACK_APP_TOKEN = 'test-app-token';
process.env.OPENAI_API_KEY = 'test-openai-key';

describe('Document Processing', () => {
  const testFiles = {
    pdf: path.join(__dirname, 'fixtures/sample.pdf'),
    docx: path.join(__dirname, 'fixtures/sample.docx'),
    txt: path.join(__dirname, 'fixtures/unsupported.txt')
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should process PDF file correctly', async () => {
    // Mock PDF file download
    const pdfBuffer = fs.readFileSync(testFiles.pdf);
    axios.get.mockResolvedValue({ data: pdfBuffer });

    const result = await downloadFile('http://valid.pdf');
    const text = await processDocument(result, 'pdf');
    
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('Sample PDF Content');
  });

  test('should process DOCX file correctly', async () => {
    // Mock DOCX file download
    const docxBuffer = fs.readFileSync(testFiles.docx);
    axios.get.mockResolvedValue({ data: docxBuffer });

    const result = await downloadFile('http://valid.docx');
    const text = await processDocument(result, 'docx');
    
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('Sample DOCX Content');
  });

  test('should reject unsupported file types', async () => {
    await expect(processDocument(Buffer.from('test'), 'txt'))
      .rejects.toThrow('Sorry Document type not supported');
  });
});
