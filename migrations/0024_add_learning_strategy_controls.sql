ALTER TABLE trading_strategies
ADD COLUMN confidence_threshold INTEGER NOT NULL DEFAULT 85;

ALTER TABLE trading_strategies
ADD COLUMN self_learning_mode TEXT NOT NULL DEFAULT 'suggest_only'
CHECK (self_learning_mode IN ('off', 'suggest_only'));
