'use strict';

import {
  AbstractQuery,
} from '@sequelize/core';

export class DuckDbQuery extends AbstractQuery {
  constructor(connection, sequelize, options) {
    super(connection, sequelize, { showWarnings: false, ...options });
  }

  async run(sql, parameters) {
    this.sql = sql;

    if (sql.startsWith("DROP TABLE")) {
      const sequence_prefix = sql.match(/^DROP TABLE IF EXISTS "([^ ]+)"/)[1]
          .replaceAll('.', '_')
          .replaceAll('"', '');

      const sequences = [];
      // clean up all the table's sequences
      sequences.push(this.connection.connection.all(
          "SELECT sequence_name FROM duckdb_sequences() WHERE starts_with(sequence_name, ?)",
          sequence_prefix
      ).then(seqResult => {
        return seqResult;
      }));

      return Promise.all(
        sequences.map(seqPromise => seqPromise.then(sequence => {
          if (sequence && sequence.length > 0 && "sequence_name" in sequence[0]) {
            //console.log("*** dropping sequence ", "DROP SEQUENCE " + sequence[0].sequence_name + " CASCADE");
            return this.connection.connection.all("DROP SEQUENCE " + sequence[0].sequence_name + " CASCADE");
          }

          return Promise.resolve();
        }))
      ).then(() => this.runQueryInternal(sql, parameters));
    }

    return this.runQueryInternal(sql, parameters);
  }

  async runQueryInternal(sql, parameters) {
    //console.log("*** QUERY: ", sql);
    let dataPromise;
    if (parameters) {
      dataPromise = this.connection.connection.all(sql, ...parameters);
    } else {
      dataPromise = this.connection.connection.all(sql);
    }

    if (this.isSelectQuery()) {
      // console.log("*** SELECT Query: ", sql, "params: ", parameters);
      // console.log("results: ", data);
      return dataPromise.then(data => this.handleSelectQuery(data));
    }

    return dataPromise.then(data => this.processResults(data));
  }

  // TBD: comment better; no longer async
  processResults(data) {
    // TBD: where should metadata come from?
    const metadata = {};
    let result = this.instance;

    if (this.isInsertQuery(data, metadata) || this.isUpsertQuery()) {
      // console.log("*** INSERT/upsert query: " + sql);

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
          //console.log("*** NORMAL ID AUTOGENERATION: setting column " + column + " to value " + data[0][column]);

          const modelColumn = modelDefinition.columns.get(column);
          if (modelColumn) {
            this.instance.set(modelColumn.attributeName, data[0][column], {
              raw: true,
              comesFromDatabase: true,
            });
          }
        }
      }

      // console.log("**** INSERT QUERY; INSTANCE: ", this.instance);

      // TBD: second parameter is number of affected rows
      return [result, metadata];

    }

    if (this.isUpdateQuery()) {
      //console.log("UPDATE QUERY; result = ", result);
      return [result, metadata];
    }

    if (this.isShowOrDescribeQuery()) {
      //console.log("*** SHOW OR DESCRIBE: ", data);
      const describeResult = {};
      for (const column of data) {
        //console.log("Found column: ", column)
        describeResult[column.column_name] = {
          type: column.column_type,
          allowNull: column.null === 'YES',
          defaultValue: column.default,
          primaryKey: column.key,
          unique: false,
        };
      }

      //console.log("Returning result: ", describeResult);
      return describeResult;
    }

    if (this.isRawQuery()) {
      // console.log("*** raw query..." + sql + "; data = ", data);

      return [data, data];
    }

    if (this.isShowConstraintsQuery() || this.isShowIndexesQuery()) {
      // those are not useful right now because constraints/indexes are unsupported
      // but they'll still return an empty array when invoked
      return data;
    }

    // TBD: return number of rows updated
    if (this.isBulkUpdateQuery() || this.isDeleteQuery()) {
      return 0;
    }


    console.log("SOMETHING UNIMPLEMENTED: " + this.options.type);

    return [data, data];
  }
}
