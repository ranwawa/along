import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaskPlanningView } from './TaskPlanningView';

describe('TaskPlanningView', () => {
  it('默认使用更窄左侧栏并提供折叠入口', () => {
    const html = renderToStaticMarkup(<TaskPlanningView />);

    expect(html).toContain('xl:grid-cols-[320px_minmax(0,1fr)]');
    expect(html).toContain('aria-label="折叠左侧栏"');
    expect(html).toContain('&lt;');
  });
});
