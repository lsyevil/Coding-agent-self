import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * 把 async 路由处理器的 reject 转交给 Express 的错误中间件。
 *
 * 为什么必须有这个东西：Express 4 只接管**同步**抛出的异常，async handler 返回的是
 * Promise，它 reject 之后 Express 完全不知情。在 Node ≥15 上默认
 * `--unhandled-rejections=throw`，于是这个 reject 会变成 **整个进程退出**。
 *
 * 这不是理论问题。实测（2026-08-31，Node v24.18.1）：
 *
 *     POST /api/auth/login  {"username":"admin","password":12345}
 *
 * 一条**不需要任何凭证**的请求就能让服务进程死掉 —— 数字 12345 过得了 `!password`
 * 判断，进到 bcrypt 里抛 `Illegal arguments: number, string`，进程随即退出，
 * 全公司登不进来且需要人工重启。
 *
 * 顺带纠正一处此前写错的结论：仓库里几处注释写的是这种情况会让「请求永久挂起」。
 * 那是在 **vitest 里**观察到的现象 —— vitest 自己装了 unhandledRejection 处理器，
 * 把崩溃吞成了挂起。独立跑的服务是**直接崩**。定级因此从体验问题上调为可用性缺陷。
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown
): RequestHandler {
  return (req, res, next) => {
    // 用 Promise.resolve 包一层：fn 同步抛出时也走同一条错误通道，
    // 不必依赖 Express 自己那套只管同步异常的处理。
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
