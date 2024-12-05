'use strict';

import {
  AbstractQuery, DatabaseError, UniqueConstraintError,
} from '@sequelize/core';
import { logger } from '@sequelize/core/_non-semver-use-at-your-own-risk_/utils/logger.js';
import { isBigInt } from "@sequelize/utils";

const debug = logger.debugContext('sql:duckdb');

export class DuckDbQuery extends AbstractQuery {
  constructor(connection, sequelize, options) {
    super(connection, sequelize, { showWarnings: false, ...options });
  }

  async run(sql, parameters) {
    this.sql = sql;
    const complete = this._logQuery(sql, debug, parameters);

    if (sql.startsWith("DROP TABLE")) {
      const sequence_prefix = sql.match(/^DROP TABLE IF EXISTS "([^ ]+)"/)[1]
          .replaceAll('.', '_')
          .replaceAll('"', '');

      const sequences = [];
      // clean up all the table's sequences
      sequences.push(this.connection.all(
          "SELECT sequence_name FROM duckdb_sequences() WHERE starts_with(sequence_name, ?)",
          sequence_prefix
      ).then(seqResult => {
        return seqResult;
      }));

      return Promise.all(
        sequences.map(seqPromise => seqPromise.then(sequence => {
          if (sequence && sequence.length > 0 && "sequence_name" in sequence[0]) {
            //console.log("*** dropping sequence ", "DROP SEQUENCE " + sequence[0].sequence_name + " CASCADE");
            return this.connection.all("DROP SEQUENCE " + sequence[0].sequence_name + " CASCADE");
          }

          return Promise.resolve();
        }))
      ).then(() => this.runQueryInternal(sql, parameters, complete));
    }

    return this.runQueryInternal(sql, parameters, complete);
  }

  formatError(err) {
    if (err.errorType === 'Constraint' &&
        (err.message.includes("Duplicate key") || err.message.includes("duplicate key"))) {
      // retry 'properly bind parameters on extra retries' test has a hardcoded condition with "Validation"
      return new UniqueConstraintError({ message: `Validation error: ${err.message}`, cause: err} );
    }


    return new DatabaseError(err);
  }

  // This is slow and terrible, but Sequelize really wants untyped string values when used without a model
  postprocessData(data, model) {
    //console.log("*** postprocess data: is it plain? ", this.options);
    if (!model) {
      // Sequelize really wants plan text data in the absence of a model
      for (const i in data) {
        for (const key in data[i]) {
          if (data[i][key] instanceof Date) {
            //console.log("got date value; turning it into a string: ", key, data[key], "str:", data[i][key].toString());
            data[i][key] = data[i][key].toISOString();
          }

        }
      }
    }
    return data;
  }

  async runQueryInternal(sql, parameters, loggingCompleteCallback) {
    //console.log("*** QUERY: ", sql, parameters);
    let dataPromise;
    if (parameters) {
      // TODO: move this into overrides
      const convertedParameters = parameters.map(p => {
        if (isBigInt(p)) {
          // TBD: BigInt binds as null in duckdb-node. check if Neo does better.
          return p.toString();
        }

        return p;
      });
      dataPromise = this.connection.all(sql, ...convertedParameters);
    } else {
      dataPromise = this.connection.all(sql);
    }

    if (this.isSelectQuery()) {
      //console.log("*** SELECT Query: ", sql, "params: ", parameters);
      return dataPromise.then(data => {
        loggingCompleteCallback();
        //console.log("results: ", data);
        return this.handleSelectQuery(this.postprocessData(data, this.model?.modelDefinition));
        //return this.handleSelectQuery(data);
      }, error => {
        throw this.formatError(error);
      });
    }

    return dataPromise.then(data => {
      loggingCompleteCallback();

      return this.processResults(data);
    }, error => {
      throw this.formatError(error)
    });
  }

  // TBD: comment better; no longer async
  processResults(data) {
    // TBD: where should metadata come from?
    const metadata = {};
    let result = this.instance;

    //console.log("*** processing results for type ", this.options.type);

    if (this.isInsertQuery(data, metadata) || this.isUpsertQuery()) {

      this.handleInsertQuery(data, metadata);

      // console.log("**** INSERT QUERY; GOT DATA: ", data);
      const modelDefinition = this.model?.modelDefinition;

      if (!this.instance) {
        // TBD: does a model need to be created?
        //console.log("*** METADATA CONSTRUCTOR: ", metadata, "aliases mapping: ", this.options.aliasesMapping);

        // TBD bulk id insert?
        result = metadata[this.getInsertIdField()];
      } else {
        // why are there multiple rows?
        //console.log("insert on existing instance; data = ", data);
        //console.log("*** NORMAL ID AUTOGENERATION; model", this.model, "model definition: ", modelDefinition);

        for (const column of Object.keys(data[0])) {
          // console.log("*** NORMAL ID AUTOGENERATION: setting column " + column + " to value " + data[0][column]);

          const modelColumn = modelDefinition.columns.get(column);
          if (modelColumn) {
            const val = data[0][column] ? modelColumn.type.parseDatabaseValue(data[0][column]) : data[0][column];
            this.instance.set(modelColumn.attributeName, val, {
              raw: true,
              comesFromDatabase: true,
            });
          }
        }
      }

      // console.log("**** INSERT QUERY; INSTANCE: ", this.instance);

      // Second value should be whether or not the row was inserted, but there is no way to know
      return [result, null];

    }

    if (this.isUpdateQuery()) {
      //console.log("UPDATE QUERY; result = ", result);
      return [result, metadata];
    }

    if (this.isShowOrDescribeQuery() || this.sql.includes('FROM duckdb_columns()')) {
      const describeResult = {};
      for (const column of data) {
        //console.log("Found column: ", column)
        describeResult[column.column_name] = {
          type: column.column_type,
          allowNull: column.null === 'YES' || column.is_nullable,
          defaultValue: column.default || null,
          primaryKey: column.key || false,
          unique: false,
        };
        if (column.comment?.includes('PRIMARY KEY')) {
          describeResult[column.column_name].primaryKey = true;
        }
      }

      //console.log("Returning result: ", describeResult);
      return describeResult;
    }

    if (this.isRawQuery()) {
      //console.log("************* RAW QUERY...; data = ", data);

      return [data, data];
    }

    if (this.isShowConstraintsQuery() || this.isShowIndexesQuery()) {
      // those are not useful right now because constraints/indexes are unsupported
      // but they'll still return an empty array when invoked
      return data;
    }

    // TBD: return number of rows updated
    if (this.isBulkUpdateQuery() || this.isDeleteQuery()) {
      // this is not amazing since the result can be larger than Number,
      // but Sequelize expects a Number...
      return Number(data[0].Count);
    }

    console.log("SOMETHING UNIMPLEMENTED: " + this.options.type);

    return [data, data];
  }
}
