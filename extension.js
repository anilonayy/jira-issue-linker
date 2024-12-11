const vscode = require("vscode");
const axios = require("axios");

function activate(context) {
  const cache = new Map();
  const CACHE_DURATION = 5 * 60 * 1000;
  
  const defaultResponse = {
    summary: "-",
    status: "Error occurred while retrieving task details",
    developer: {},
    qa: {},
    completeDate: '',
  };
  
  const config = vscode.workspace.getConfiguration("jiraIssueLinker");

  const issueRegex = /\b[A-Z]+-\d+\b/g;
  const jiraBaseURL = config.get("jiraBaseURL") || "";
  const taskGetterURL = config.get("taskGetterURL") || "";
  
  if (!jiraBaseURL || !taskGetterURL) {
    vscode.window.showErrorMessage("Jira issue linker: Jira base URL or task getter URL is not set")
  }
  

  async function getTaskDetail(taskKey) {
    const cachedData = cache.get(taskKey);
    const now = Date.now();
    
    for (const [key, value] of cache.entries()) {
      if (now - value.timestamp >= CACHE_DURATION) {
        cache.delete(key);
      }
    }

    
    if (cachedData && (now - cachedData.timestamp) < CACHE_DURATION) {
      return cachedData.data;
    }


    try {
      const resp = await axios.get(`${taskGetterURL}/${taskKey}`);
      const respData = resp.data ?? {};

      const data = {
        summary: respData.title ?? '-',
        status: respData.status ?? '-',
        developer: respData.developer ?? '-',
        qa: respData.qa_tester ?? '-',
        completeDate: respData.last_uat_opam_date ?? '',
      };
      
      cache.set(taskKey, { data, timestamp: now });

      return data;
    } catch (error) {
      vscode.window.showErrorMessage(`API request failed: ${error.message}`);
      
      cache.set(taskKey, {data: defaultResponse, timestamp: now});
      
      return defaultResponse;
    }
  }

  const hoverProvider = {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position, issueRegex);
      if (!range) return;

      const taskKey = document.getText(range);

      return new Promise((resolve) => {
        getTaskDetail(taskKey).then(({ summary, developer, status, qa, completeDate }) => {
          const popUpContext = [
          `**Name:** ${summary}`,
          `**Status:** ${status}`
          ];

          if (developer) {
            popUpContext.push(
            `**Developer:** ${developer}`
            );
          }

          if (qa) {
            popUpContext.push(
            `**QA:** ${qa}`
            );
          }

          if (completeDate) {
            popUpContext.push(`**Complete Date:** ${completeDate}`);
          }

          resolve(new vscode.Hover(popUpContext));
        });
      });
    },
  };

  const decorationType = vscode.window.createTextEditorDecorationType({
    textDecoration: "underline",
    cursor: "pointer"
  });

  function updateDecorations(editor) {
    if (!editor || !jiraBaseURL) return;

    const text = editor.document.getText();
    const decorations = [];

    let match;
    while ((match = issueRegex.exec(text)) !== null) {
      const startPos = editor.document.positionAt(match.index);
      const endPos = editor.document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);
      
      decorations.push({
        range,
        hoverMessage: `**Task:** [${match[0]}](${jiraBaseURL}/browse/${match[0]})`
      });
    }

    editor.setDecorations(decorationType, decorations);
  }
  

  function triggerDecorationsForCurrentEditor() {
    const editor = vscode.window.activeTextEditor;
    if (editor) updateDecorations(editor);
  }

  vscode.workspace.onDidOpenTextDocument((document) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document === document) {
      updateDecorations(editor);
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) {
      updateDecorations(editor);
    }
  }, null, context.subscriptions);

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor) updateDecorations(editor);
  }, null, context.subscriptions);

  ["javascript", "html", "css"].forEach((language) => {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider({ scheme: "file", language }, hoverProvider)
    );
  });
  
  const linkProvider = vscode.languages.registerDocumentLinkProvider('*', {
    provideDocumentLinks(document) {
        const text = document.getText();
        const links = [];
        let match;
        while ((match = issueRegex.exec(text)) !== null) {
            const start = document.positionAt(match.index);
            const end = document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(start, end);
            const link = vscode.Uri.parse(`${jiraBaseURL}/browse/${match[0]}`); 

            links.push(new vscode.DocumentLink(range, link));
        }

        return links;
      },
  });

context.subscriptions.push(linkProvider);

  triggerDecorationsForCurrentEditor();
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
