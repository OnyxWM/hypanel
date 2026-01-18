import { Request, Response, NextFunction } from "express";
import { z } from "zod";
export declare function validateBody(schema: z.ZodSchema): (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare function validateParams(schema: z.ZodSchema): (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=validation.d.ts.map