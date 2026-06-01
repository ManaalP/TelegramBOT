const { StateGraph, Annotation, MemorySaver, START, END } = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { GEMINI_API_KEY, GEMINI_MODEL } = require("../config");
const { resolveQuery } = require("../gemini/router");
const { fetchEmails } = require("../gmail/fetcher");
const { analyse } = require("../gemini/analyser");
const { sendEmail } = require("../gmail/sender");

// Define the State schema for our workflow
const GraphState = Annotation.Root({
  chatId: Annotation(),
  userQuery: Annotation(),
  intent: Annotation(),
  gmailQuery: Annotation(),
  rawEmails: Annotation(),
  cleanedData: Annotation(),
  analysisResult: Annotation(),
  pendingAction: Annotation(),
  actionApproved: Annotation(),
  executionResult: Annotation(),
  error: Annotation()
});

// 1. Intent Node
async function intentNode(state) {
  try {
    let { intent, query } = await resolveQuery(state.userQuery);
    
    if (intent === 3 && query && query !== "OUT_OF_SCOPE") {
      query = query.replace(/\bbook(ed|ing|s)?\b/gi, '')
                   .replace(/\bflight[s]?\b/gi, '(flight OR PNR OR "boarding pass" OR ticket)')
                   .replace(/\s+/g, ' ').trim();
    }

    return { intent, gmailQuery: query };
  } catch (err) {
    return { error: `Intent resolution failed: ${err.message}` };
  }
}

// 2. Gmail Retrieval Node
async function gmailRetrievalNode(state) {
  if (state.error || state.intent === 0) return {};
  try {
    const fetchRes = await fetchEmails(state.chatId, state.gmailQuery, state.intent);
    return { rawEmails: fetchRes.emailData };
  } catch (err) {
    return { error: `Gmail retrieval failed: ${err.message}` };
  }
}

// 3. Data Cleaning Node
async function dataCleaningNode(state) {
  if (state.error || !state.rawEmails) return {};
  
  // Example cleaning: remove internal AI prompt instructions to compress context payload
  const cleaned = state.rawEmails.replace(/--- GLOBAL AI INSTRUCTION ---[\s\S]*?\n/g, "").trim();
  return { cleanedData: cleaned };
}

// 4. Analysis Node
async function analysisNode(state) {
  if (state.error) return {};
  try {
    const { answer } = await analyse(state.userQuery, state.cleanedData || "No data", state.intent);
    
    // Check if AI generated a command requiring human approval
    let pendingAction = null;
    if (answer.includes("/preview")) {
       pendingAction = { type: "email_draft", payload: answer };
    }
    
    return { analysisResult: answer, pendingAction };
  } catch (err) {
    return { error: `Analysis failed: ${err.message}` };
  }
}

// 5. Human Approval Node
function humanApprovalNode(state) {
  if (state.error || !state.pendingAction) return {};
  // LangGraph pauses execution here by waiting for 'actionApproved'
  // In Telegram, you'd trigger an interrupt() and wait for the user to reply 'okay'
  return {};
}

// 6. Execution Node
async function executionNode(state) {
  if (state.error || !state.pendingAction || !state.actionApproved) return {};
  
  if (state.pendingAction.type === "email_draft") {
    // Parse the payload and call sendEmail() execution logic here
    return { executionResult: "Action executed based on human approval." };
  }
  return { executionResult: "Action executed." };
}

// Routing logic
function routeAfterAnalysis(state) {
  if (state.error) return END;
  if (state.pendingAction && state.actionApproved === undefined) return "humanApprovalNode";
  return END;
}

function routeAfterApproval(state) {
  if (state.actionApproved === true) return "executionNode";
  return END; // Action cancelled by human
}

// Build the LangGraph Workflow
const workflow = new StateGraph(GraphState)
  .addNode("intentNode", intentNode)
  .addNode("gmailRetrievalNode", gmailRetrievalNode)
  .addNode("dataCleaningNode", dataCleaningNode)
  .addNode("analysisNode", analysisNode)
  .addNode("humanApprovalNode", humanApprovalNode)
  .addNode("executionNode", executionNode)
  .addEdge(START, "intentNode")
  .addEdge("intentNode", "gmailRetrievalNode")
  .addEdge("gmailRetrievalNode", "dataCleaningNode")
  .addEdge("dataCleaningNode", "analysisNode")
  .addConditionalEdges("analysisNode", routeAfterAnalysis)
  .addConditionalEdges("humanApprovalNode", routeAfterApproval)
  .addEdge("executionNode", END);

const checkpointer = new MemorySaver();
const chatAgent = workflow.compile({ checkpointer });

module.exports = { chatAgent };