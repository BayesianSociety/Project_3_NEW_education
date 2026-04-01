import { NextResponse } from 'next/server';

import { getAnalyticsOverview, getPuzzleAnalytics, getReplay } from '@/lib/telemetry';

type ViewParams = {
  view: string;
};

export async function GET(request: Request, context: { params: Promise<ViewParams> }) {
  const params = await context.params;
  const view = params.view;
  const url = new URL(request.url);
  try {
    if (view === 'overview') {
      const data = getAnalyticsOverview();
      return NextResponse.json(data, { status: 200 });
    }
    if (view === 'puzzle') {
      const puzzleId = url.searchParams.get('puzzleId');
      if (!puzzleId) {
        return NextResponse.json({ error: 'puzzleId is required' }, { status: 400 });
      }
      const data = getPuzzleAnalytics(puzzleId);
      return NextResponse.json(data, { status: 200 });
    }
    if (view === 'replay') {
      const attemptParam = url.searchParams.get('attemptId');
      const attemptId = attemptParam ? Number(attemptParam) : NaN;
      if (!attemptId || Number.isNaN(attemptId)) {
        return NextResponse.json({ error: 'attemptId is required' }, { status: 400 });
      }
      const data = getReplay(attemptId);
      return NextResponse.json(data, { status: 200 });
    }
    return NextResponse.json({ error: `Unsupported analytics view: ${view}` }, { status: 404 });
  } catch (error) {
    console.error('Analytics route failed', error);
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
