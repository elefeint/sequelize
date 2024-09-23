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

    const pos_newline = sql.indexOf("\n", 3);
    const sqltoprint = pos_newline >= 0 ? sql.substring(0, pos_newline) + " ... " : sql;
    //console.log("DUCKDB RUN; db path " + this.connection.db_path + "; sql = " + sqltoprint);

    if (sql.startsWith("DROP TABLE")) {
      const tableName = sql.match(/^DROP TABLE IF EXISTS "([^"]+)"/)[1];
      //console.log("*** THE TABLE NAME IS ", tableName);
      // clean up all the table's sequences
      const sequences = await this.connection.db.all(
          "SELECT sequence_name FROM duckdb_sequences() WHERE starts_with(sequence_name, ?)",
          tableName
      );

      return Promise.all(sequences.map(seq => this.connection.db.all("DROP SEQUENCE " + seq['sequence_name'] + " CASCADE"))).then(unused => [0,0])

    }


    let data;
    if (parameters) {
      data = await this.connection.db.all(sql, ...parameters);
    } else {
      data = await this.connection.db.all(sql);
    }

    let result = this.instance;
    if (this.isSelectQuery()) {
      //console.log("*** SELECT Query: ", sql, "params: ", parameters);
      //console.log("results: ", data);
      return this.handleSelectQuery(data);
    }

    const metadata = {};
    if (this.isInsertQuery(data, metadata) || this.isUpsertQuery()) {
      //console.log("*** INSERT/upsert query: " + sql);

      this.handleInsertQuery(data, metadata);

      //console.log("**** INSERT QUERY; GOT DATA: ", data);

      if (!this.instance) {
        //console.log("***** WHY IS THERE NO INSTANCE? ******");
      } else {
        // why are there multiple rows?
        //console.log("*** NORMAL ID AUTOGENERATION");
        //result = data[this.getInsertIdField()];
        for (const column of Object.keys(data[0])) {
          //console.log("*** NORMAL ID AUTOGENERATION: setting column " + column + " to value " + data[0][column]);
          this.instance.set(column, data[0][column], {
            raw: true,
            comesFromDatabase: true,
          });
        }
      }

      //console.log("**** INSERT QUERY; INSTANCE: ", this.instance);


      // TBD: second parameter is number of affected rows
      return [result, metadata];

    }

    if (this.isRawQuery()) {
      //console.log("*** raw query..." + sql + "; data = ", data);

      return [data, data];
    }


    if (this.isShowConstraintsQuery()) {
      //console.log("*** show constraints..." + sql);
      //console.log("*** show constraints...");
      return data;
    }

    if (this.isShowIndexesQuery()) {
      //console.log("*** show indexes..." + sql);
     // console.log("*** show indexes...");
      return data;
    }

    // TBD: return number of rows updated
    if (this.isBulkUpdateQuery() || this.isDeleteQuery()) {
      return 0;
    }


    //console.log("SOMETHING UNIMPLEMENTED: " + this.options.type);

    return [data, data];
  }
}
