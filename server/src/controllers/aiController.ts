import { Request, Response, NextFunction } from 'express';
import { ask, getContext }                 from '../ai/aiService';

// POST /ai/ask  — { question: string }
export async function askQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { question } = req.body as { question?: string };
    if (!question?.trim()) {
      return next(Object.assign(new Error('question is required'), { statusCode: 400 }));
    }

    const callerId = req.ip ?? 'unknown';
    const result   = await ask({ question, callerId });

    res.json({
      answer:    result.answer,
      provider:  result.provider,
      model:     result.model,
      latencyMs: result.latencyMs,
      canned:    result.canned,
      capturedAt: result.capturedAt,
    });
  } catch (e) { next(e); }
}

// GET /ai/context  — returns the raw context object (no LLM call, useful for debugging)
export function getOfficeContext(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(getContext());
  } catch (e) { next(e); }
}
