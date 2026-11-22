-- Lepvi Finanças: tabelas próprias (banco separado do site e do Hub da Lepvi).
-- Roda sozinho na primeira requisição, em MySQL e em SQLite (testes).
CREATE TABLE IF NOT EXISTS usuarios (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  nome VARCHAR(120) NOT NULL,
  foto LONGTEXT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  email_verificado INTEGER NOT NULL DEFAULT 0,
  avisos INTEGER NOT NULL DEFAULT 1,
  aceite_versao VARCHAR(20) NOT NULL,
  aceite_em INTEGER NOT NULL,
  criado_em INTEGER NOT NULL,
  ultimo_login INTEGER NULL
);
CREATE TABLE IF NOT EXISTS sessoes (
  hash VARCHAR(64) NOT NULL PRIMARY KEY,
  usuario_id VARCHAR(32) NOT NULL,
  expira_em INTEGER NOT NULL,
  criado_em INTEGER NOT NULL
);
CREATE INDEX idx_sessoes_usuario ON sessoes (usuario_id);
CREATE TABLE IF NOT EXISTS tokens (
  hash VARCHAR(64) NOT NULL PRIMARY KEY,
  usuario_id VARCHAR(32) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  expira_em INTEGER NOT NULL
);
CREATE INDEX idx_tokens_usuario ON tokens (usuario_id);
CREATE TABLE IF NOT EXISTS dados (
  usuario_id VARCHAR(32) NOT NULL PRIMARY KEY,
  conteudo LONGTEXT NOT NULL,
  versao INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tentativas (
  chave VARCHAR(190) NOT NULL,
  quando INTEGER NOT NULL
);
CREATE INDEX idx_tentativas_chave ON tentativas (chave);
CREATE TABLE IF NOT EXISTS avisos (
  usuario_id VARCHAR(32) NOT NULL,
  chave VARCHAR(190) NOT NULL,
  enviado_em INTEGER NOT NULL,
  PRIMARY KEY (usuario_id, chave)
);
CREATE TABLE IF NOT EXISTS consentimentos (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  usuario_id VARCHAR(32) NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  versao VARCHAR(20) NOT NULL,
  quando INTEGER NOT NULL
);
CREATE INDEX idx_consent_usuario ON consentimentos (usuario_id);
CREATE TABLE IF NOT EXISTS identidades (
  provedor VARCHAR(20) NOT NULL,
  sub VARCHAR(190) NOT NULL,
  usuario_id VARCHAR(32) NOT NULL,
  criado_em INTEGER NOT NULL,
  PRIMARY KEY (provedor, sub)
);
