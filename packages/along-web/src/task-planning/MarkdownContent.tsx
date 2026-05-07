import {
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MermaidState =
  | { status: 'idle' }
  | { status: 'rendered'; svg: string }
  | { status: 'failed'; message: string };

type CodeElementProps = {
  children?: ReactNode;
  className?: string;
  'data-code-language'?: string;
};

function nodeToText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(nodeToText).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToText(node.props.children);
  }
  return '';
}

function isCodeElement(
  node: ReactNode,
): node is ReactElement<CodeElementProps> {
  return isValidElement<CodeElementProps>(node);
}

function normalizeMermaidId(value: string): string {
  return `mermaid-${value.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

async function renderMermaidSvg(chart: string, renderId: string) {
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark',
  });
  return mermaid.render(renderId, chart);
}

function useMermaidSvg(chart: string): MermaidState {
  const fallbackId = useId();
  const [state, setState] = useState<MermaidState>({ status: 'idle' });

  useEffect(() => {
    let cancelled = false;
    const renderId = normalizeMermaidId(fallbackId);

    setState({ status: 'idle' });
    renderMermaidSvg(chart, renderId)
      .then(({ svg }) => {
        if (!cancelled) setState({ status: 'rendered', svg });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chart, fallbackId]);

  return state;
}

export function MermaidCodeFallback({
  chart,
  error,
}: {
  chart: string;
  error?: string;
}) {
  return (
    <div data-mermaid-fallback="">
      {error && (
        <div className="mb-2 text-xs leading-5 text-amber-200">
          Mermaid 渲染失败，已显示原始代码。
        </div>
      )}
      <pre className="overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs leading-5 text-text-secondary">
        <code>{chart}</code>
      </pre>
    </div>
  );
}

export function MermaidDiagram({ chart }: { chart: string }) {
  const state = useMermaidSvg(chart);

  if (state.status === 'rendered') {
    return (
      <div className="overflow-auto rounded-md border border-white/10 bg-black/30 p-3">
        <img
          data-mermaid-diagram=""
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(
            state.svg,
          )}`}
          alt="Mermaid diagram"
          className="max-w-full"
        />
      </div>
    );
  }

  return (
    <div data-mermaid-diagram="">
      <MermaidCodeFallback
        chart={chart}
        error={state.status === 'failed' ? state.message : undefined}
      />
    </div>
  );
}

const markdownComponents: Components = {
  a({ children, href, node: _node, ...props }) {
    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-cyan-200 underline decoration-cyan-200/40 underline-offset-2 hover:text-cyan-100"
      >
        {children}
      </a>
    );
  },
  h1({ children, node: _node, ...props }) {
    return (
      <h1
        {...props}
        className="mb-3 mt-4 text-lg font-semibold leading-7 text-text-primary first:mt-0"
      >
        {children}
      </h1>
    );
  },
  h2({ children, node: _node, ...props }) {
    return (
      <h2
        {...props}
        className="mb-2 mt-4 text-base font-semibold leading-6 text-text-primary first:mt-0"
      >
        {children}
      </h2>
    );
  },
  h3({ children, node: _node, ...props }) {
    return (
      <h3
        {...props}
        className="mb-2 mt-3 text-sm font-semibold leading-6 text-text-primary first:mt-0"
      >
        {children}
      </h3>
    );
  },
  p({ children, node: _node, ...props }) {
    return (
      <p {...props} className="my-2 leading-6 first:mt-0 last:mb-0">
        {children}
      </p>
    );
  },
  ul({ children, node: _node, ...props }) {
    return (
      <ul
        {...props}
        className="my-2 list-disc space-y-1 pl-5 leading-6 first:mt-0 last:mb-0"
      >
        {children}
      </ul>
    );
  },
  ol({ children, node: _node, ...props }) {
    return (
      <ol
        {...props}
        className="my-2 list-decimal space-y-1 pl-5 leading-6 first:mt-0 last:mb-0"
      >
        {children}
      </ol>
    );
  },
  li({ children, node: _node, ...props }) {
    return <li {...props}>{children}</li>;
  },
  blockquote({ children, node: _node, ...props }) {
    return (
      <blockquote
        {...props}
        className="my-2 border-l-2 border-cyan-400/50 pl-3 text-text-secondary"
      >
        {children}
      </blockquote>
    );
  },
  table({ children, node: _node, ...props }) {
    return (
      <div className="my-3 overflow-auto">
        <table
          {...props}
          className="min-w-full border-collapse text-left text-xs"
        >
          {children}
        </table>
      </div>
    );
  },
  th({ children, node: _node, ...props }) {
    return (
      <th
        {...props}
        className="border border-white/10 bg-white/5 px-2 py-1 font-semibold text-text-secondary"
      >
        {children}
      </th>
    );
  },
  td({ children, node: _node, ...props }) {
    return (
      <td {...props} className="border border-white/10 px-2 py-1">
        {children}
      </td>
    );
  },
  code({ children, className, node: _node, ...props }) {
    const language = /language-(\S+)/.exec(className || '')?.[1];
    return (
      <code
        {...props}
        data-code-language={language}
        className={
          className ||
          'rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[0.85em] text-text-secondary'
        }
      >
        {children}
      </code>
    );
  },
  pre({ children, node: _node, ...props }) {
    if (isCodeElement(children)) {
      const language =
        children.props['data-code-language'] ||
        /language-(\S+)/.exec(children.props.className || '')?.[1];
      const content = nodeToText(children.props.children).replace(/\n$/, '');
      if (language === 'mermaid') {
        return <MermaidDiagram chart={content} />;
      }
      return (
        <pre
          {...props}
          className="my-3 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs leading-5 text-text-secondary"
        >
          <code className={children.props.className}>{content}</code>
        </pre>
      );
    }
    return (
      <pre
        {...props}
        className="my-3 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-xs leading-5 text-text-secondary"
      >
        {children}
      </pre>
    );
  },
};

export function MarkdownContent({ value }: { value: string }) {
  return (
    <div className="min-w-0 break-words text-sm leading-6 text-text-primary">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
