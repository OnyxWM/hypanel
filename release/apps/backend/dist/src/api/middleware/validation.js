import { z } from "zod";
export function validateBody(schema) {
    return (req, res, next) => {
        try {
            req.body = schema.parse(req.body);
            next();
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    error: "Validation error",
                    details: error.errors,
                });
            }
            next(error);
        }
    };
}
export function validateParams(schema) {
    return (req, res, next) => {
        try {
            req.params = schema.parse(req.params);
            next();
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({
                    error: "Validation error",
                    details: error.errors,
                });
            }
            next(error);
        }
    };
}
export function errorHandler(err, req, res, next) {
    console.error("Error:", err);
    if (!res.headersSent) {
        res.status(500).json({
            error: "Internal server error",
            message: err.message,
        });
    }
}
//# sourceMappingURL=validation.js.map