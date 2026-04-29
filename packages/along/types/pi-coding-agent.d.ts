declare module '@mariozechner/pi-coding-agent' {
  import { TObject } from '@sinclair/typebox';

  export interface ToolDefinition<P = any> {
    name: string;
    description: string;
    parameters: TObject;
    execute: (
      toolCallId: string,
      params: P,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: any;
    }>;
  }

  export interface ExtensionAPI {
    registerTool<P = any>(tool: ToolDefinition<P>): void;
  }
}
