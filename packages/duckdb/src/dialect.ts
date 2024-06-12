import * as DataTypes from './_internal/data-types-overrides';
import type { Sequelize } from '@sequelize/core';
import { AbstractDialect } from '@sequelize/core';
import type { DuckDbConnectionOptions } from "./connection-manager";
import { DuckDbQuery } from "./query";
import { DuckDbConnectionManager } from "./connection-manager";
import { DuckDbQueryGenerator } from "./query-generator";
import { DuckDbQueryInterface } from "./query-interface";
import { createNamedParamBindCollector } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/sql.js';
import {getSynchronizedTypeKeys} from "@sequelize/utils";

export interface DuckDbDialectOptions {
}

const DIALECT_OPTION_NAMES = getSynchronizedTypeKeys<DuckDbDialectOptions>({
});

const CONNECTION_OPTION_NAMES = getSynchronizedTypeKeys<DuckDbConnectionOptions>({
  database: undefined,
  mode: undefined,
});

export class DuckDbDialect extends AbstractDialect<DuckDbDialectOptions, DuckDbConnectionOptions> {
  parseConnectionUrl(_url: string): DuckDbConnectionOptions {
    throw new Error(
      'The "url" option is not supported in DuckDb. Please use the "database" option instead.',
    );
  }

  // TODO: supports what?
  static supports = AbstractDialect.extendSupport({
    DEFAULT: false,
    'DEFAULT VALUES': true,
    'UNION ALL': false,
    'RIGHT JOIN': false,
    inserts: {
      ignoreDuplicates: ' OR IGNORE',
      updateOnDuplicate: ' ON CONFLICT DO UPDATE SET',
      conflictFields: true,
      onConflictWhere: true,
    },
    index: {
      using: false,
      where: true,
      functionBased: true,
    },
    startTransaction: {
      useBegin: true,
      transactionType: true,
    },
    constraints: {
      foreignKeyChecksDisableable: true,
      add: false,
      remove: false,
    },
    groupedLimit: false,
    dataTypes: {
      CHAR: false,
      COLLATE_BINARY: true,
      CITEXT: false,
      DECIMAL: {
        unconstrained: true,
        constrained: true,
        NaN: true,
        infinity: true,
      },
      JSON: true,
    },
    jsonOperations: false,
    jsonExtraction: {
      unquoted: false,
      quoted: false,
    },
    truncate: {
      restartIdentity: false,
    },
  });

  readonly Query = DuckDbQuery;
  readonly connectionManager: DuckDbConnectionManager;
  readonly dataTypesDocumentationUrl = 'https://motherduck.com/docs';
  readonly queryGenerator: DuckDbQueryGenerator;
  readonly queryInterface: DuckDbQueryInterface;

  // TBD: options useful?
  constructor(sequelize: Sequelize, options: DuckDbDialectOptions) {
    super({
      identifierDelimiter: '"',
      options,
      sequelize,
      minimumDatabaseVersion: '0.10.2',
      dataTypesDocumentationUrl: 'https://duckdb.org/docs/sql/data_types/overview.html',
      dataTypeOverrides: DataTypes,
      name: "duckdb",
    });
    this.connectionManager = new DuckDbConnectionManager(this);
    this.queryGenerator = new DuckDbQueryGenerator(this);
    this.queryInterface = new DuckDbQueryInterface(this);
  }

  createBindCollector() {
    // TBD
    return createNamedParamBindCollector('$');
  }

  getDefaultSchema(): string {
    return 'main';
  }

  static getDefaultPort() {
    return 0;
  }

  static getSupportedOptions() {
    return DIALECT_OPTION_NAMES;
  }

  static getSupportedConnectionOptions(): readonly string[] {
    return CONNECTION_OPTION_NAMES;
  }
}