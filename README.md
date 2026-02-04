# Contexty (HSCMM)

A Visual Studio Code extension that provides enhanced context management capabilities for developers. This extension allows you to select, organize, and track code snippets and files as contextual references in your workspace.

## Features

### 🗂️ Context Explorer

- **Tree View Panel**: A dedicated explorer panel that displays your collected context in a hierarchical structure
- **Multi-root Workspace Support**: Works seamlessly across multiple workspace folders
- **Organized Display**: Shows context organized by folders and files with expandable/collapsible views
- **Visual Indicators**:
  - File icons for different item types (files, folders, snippets)
  - Part counts displayed per file
  - Full file vs. snippet differentiation

### ✨ Context Highlights

- **Visual Feedback**: Automatically highlights code sections that have been added to your context
- **Background Color**: Uses a subtle blue highlight (`rgba(120, 190, 255, 0.18)`) to indicate contextual code
- **Real-time Updates**: Highlights update automatically when switching between editors or modifying context

### 📝 Selection Management

- **Code Lens Integration**: Shows an inline "Add to Context" button above your text selection
- **Status Bar Button**: Quick access button appears in the status bar when text is selected
- **Multiple Selection Methods**:
  - Right-click context menu on editor selections
  - Editor title bar button when text is selected
  - Command palette commands
  - Drag and drop support

### 📂 File & Folder Context

- **Full File Addition**: Add entire files to your context with one click
- **Batch Operations**: Add multiple files or entire directories at once
- **Explorer Integration**: Right-click on files/folders in VS Code Explorer to add to context
- **Drag and Drop**: Drag files and folders directly into the Context Explorer panel
- **Automatic Scanning**: When adding folders, automatically scans and adds all files (excludes `node_modules`)

### 💾 Persistent Storage

- **Workspace-level Storage**: Context is stored in `.contexty` folder within each workspace root
- **JSON Format**: Stores context as structured JSON files for easy inspection and version control
- **Session Tracking**: Maintains session IDs to track different working sessions
- **Blacklist Support**: Maintains a blacklist of removed context items

## Commands

The extension provides the following commands:

| Command                                           | Description                        | Keyboard Shortcut |
| ------------------------------------------------- | ---------------------------------- | ----------------- |
| `contexty.hscmm.refresh`                          | Refresh the Context Explorer       | -                 |
| `contexty.hscmm.addSelectionToContext`            | Add selected text to context       | -                 |
| `contexty.hscmm.addSelectionToContextWithCurrent` | Add current selection to context   | -                 |
| `contexty.hscmm.removePart`                       | Remove a code snippet from context | -                 |
| `contexty.hscmm.removeFileContext`                | Remove a file/folder from context  | -                 |
| `contexty.hscmm.addFileToContext`                 | Add file(s) to context             | -                 |

## Usage

### Adding Code Snippets

1. Select text in any file
2. Use one of these methods:
   - Click the "➕ Add to Context" button in the status bar
   - Right-click and select "Add to Context"
   - Click the Code Lens button that appears above your selection
3. The selection will appear in the Context Explorer panel

### Adding Files

1. In the Explorer panel, right-click on a file or folder
2. Select "Add to Context"
3. For folders, all files within (excluding `node_modules`) will be added

### Removing Context Items

1. Navigate to the Context Explorer panel
2. Hover over the item you want to remove
3. Click the "✕" (close) icon that appears

### Viewing Context

- Open the "Context Explorer" panel in the Explorer sidebar
- Expand files to see individual code snippets
- Click on any item to open the file at that location
- Context sections are highlighted with a blue background

## Storage Structure

Context data is stored in your workspace under `.contexty/`:

```
.contexty/
├── tool-parts.json              # Main context storage
└── tool-parts.blacklist.json    # Removed items
```

### tool-parts.json Format

Each context item is stored as a "tool part" with the following structure:

```json
{
  "parts": [
    {
      "id": "prt_<timestamp><random>",
      "sessionID": "ses_<timestamp><random>",
      "messageID": "msg_<timestamp><random>",
      "type": "tool",
      "callID": "call_<timestamp><random>",
      "tool": "read",
      "state": {
        "status": "completed",
        "input": {
          "filePath": "/absolute/path/to/file"
        },
        "output": "<file>\n00001| code line 1\n00002| code line 2\n</file>",
        "title": "relative/path/to/file",
        "metadata": {
          "preview": "code preview...",
          "truncated": false
        },
        "time": {
          "start": 1234567890,
          "end": 1234567890
        }
      }
    }
  ]
}
```

## Technical Architecture

### Core Components

#### ContextState (`state.ts`)

- **Central state management** for all context data
- **Persistence layer** handling `.contexty` folder operations
- **ID generation** for unique identifiers (parts, sessions, messages)
- **Formatting** code with line numbers
- **Blacklist management** for removed items
- **Multi-root workspace support**

#### ContextExplorer (`contextExplorer.ts`)

- **Tree data provider** implementing VS Code's tree view interface
- **Drag and drop controller** for file/folder operations
- **Hierarchical organization** of context items
- **File system watching** for automatic updates
- **Navigation** to source code on item click

#### ContextHighlights (`contextHighlights.ts`)

- **Text decoration** for visual highlighting
- **Multi-editor support** across visible editors
- **Real-time updates** based on context changes
- **Configurable background color** for highlighted sections

#### SelectionLens (`selectionLens.ts`)

- **Code Lens provider** for inline action buttons
- **Selection tracking** per document
- **Dynamic button display** based on selection state
- **Clear API** for selection management

### Key Features Implementation

#### Line Number Formatting

Code is stored with line numbers in a consistent format:

```
00001| const example = 'value';
00002| function demo() {
00003|   return example;
00004| }
```

#### ID Generation

Uses a custom scheme combining timestamp and random alphanumeric characters:

- Format: `{prefix}_{timestampHex}{14randomChars}`
- Prefixes: `prt` (part), `ses` (session), `msg` (message), `call` (call)
- Example: `prt_01234567890abcdefghijklmn`

#### Workspace Integration

- Respects `.gitignore` and workspace settings
- Excludes `node_modules` by default
- Works with multi-root workspaces
- Integrates with native VS Code explorer views

## Development

### Prerequisites

- Node.js 22.x or higher
- Visual Studio Code 1.108.0 or higher

### Building

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Run tests
npm test

# Lint code
npm run lint
```

### Project Structure

```
.
├── src/
│   ├── extension.ts           # Extension activation & command registration
│   ├── state.ts              # Core state management & persistence
│   ├── contextExplorer.ts    # Tree view provider & drag-drop
│   ├── contextHighlights.ts  # Code highlighting decoration
│   ├── selectionLens.ts      # Code lens provider for selections
│   └── test/
│       └── extension.test.ts # Test suite
├── resources/
│   └── icons/                # Extension icons
├── package.json              # Extension manifest
├── tsconfig.json            # TypeScript configuration
└── eslint.config.mjs        # ESLint configuration
```

## Extension Settings

Currently, this extension does not contribute any custom settings. All functionality works out-of-the-box.

## Known Limitations

- Context storage is workspace-specific (not synced across machines)
- Large files may take longer to process
- Binary files are not supported
- Context highlighting only works for text editors with `file://` scheme

## Contributing

This extension is published by `ttalkkak-lab`. For contributions or issues, please refer to the repository guidelines.

## License

Please refer to the LICENSE file in the repository for licensing information.

## Version History

### 0.0.1 (Initial Release)

- Context Explorer panel with tree view
- Add/remove code snippets and files
- Visual highlighting of context sections
- Code Lens integration for quick actions
- Drag and drop support
- Multi-root workspace support
- Persistent storage in `.contexty` folder

---

**Enjoy enhanced context management with Contexty (HSCMM)!** 🚀
