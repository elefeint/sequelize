'use strict';

import isObject from "lodash/isObject";

const { DuckDbQueryGeneratorTypeScript } = require('./query-generator-typescript.internal');

export class DuckDbQueryGenerator extends DuckDbQueryGeneratorTypeScript {
  createTableQuery(tableName, attributes, _options) {

    const table = this.quoteTable(tableName);

    let sequence_sql = '';
    const attrArray = [];
    //const primaryKeys = [];

    for (const attr in attributes) {
      const columnName = this.quoteIdentifier(attr);

      if (Object.hasOwn(attributes, attr)) {
        let dataType = attributes[attr];

        const table_prefix = this.quoteTable(table)
            .replaceAll('"', '')
            .replaceAll('.', '_');
        const sequence_name = table_prefix + '_' + attr + '_seq';

        if (dataType.includes('AUTOINCREMENT')) {
          // TBD: is if not exists needed if table cleans up correctly?
          sequence_sql = 'CREATE SEQUENCE IF NOT EXISTS ' + this.quoteIdentifier(sequence_name) + ' START 1; ';
          // this could be done in attributesToSQL but better keep it with sequence_name generation in case it changes
          dataType = dataType.replace('AUTOINCREMENT', `DEFAULT nextval('${sequence_name}')`)
        }

        // if (dataType.includes(' PRIMARY KEY')) {
        //   dataType = dataType.replace(' PRIMARY KEY', '');
        //   primaryKeys.push(columnName);
        // }

        attrArray.push(`${columnName} ${dataType}`);
      }
    }

    let attrStr = attrArray.join(', ');
    // primary and foregin keys are disabled due to https://duckdb.org/docs/sql/indexes#over-eager-unique-constraint-checking
    // if (primaryKeys.length > 0) {
    //   attrStr += `, PRIMARY KEY (${primaryKeys.join(',')})`;
    // }

    const sql = `${sequence_sql}CREATE TABLE IF NOT EXISTS ${table} (${attrStr});`;
    //console.log("CREATE TABLE sql: ", sql);
    return sql;
  }


  attributesToSQL(attributes, options) {
    const result = {};

    for (const name in attributes) {
      const attribute = attributes[name];
      const columnName = attribute.field || attribute.columnName || name;

      if (isObject(attribute)) {
        let sql = attribute.type.toString();

        if (attribute.allowNull === false) {
          sql += ' NOT NULL';
        }

        if (attribute.autoIncrement) {
          // unsupported syntax placeholder; will be replaced in createTableQuery
          sql += ' AUTOINCREMENT';
        }

        // primary and foregin keys are disabled due to https://duckdb.org/docs/sql/indexes#over-eager-unique-constraint-checking
        /*
        if (attribute.primaryKey) {
          // will be replaced with PRIMARY KEY clause in createTableQuery
          sql += ' PRIMARY KEY';
        }

        // foreign keys are trouble because duckdb does not support adding/removing them,
        // so integration tests end up very unhappy -- constraints can't get dropped,
        // but tables can't get dropped while constraints exist.
        if (attribute.references) {
          const referencesTable = this.quoteTable(attribute.references.table);

          let referencesKey;
          if (attribute.references.key) {
            referencesKey = this.quoteIdentifier(attribute.references.key);
          } else {
            referencesKey = this.quoteIdentifier('id');
          }

          sql += ` REFERENCES ${referencesTable} (${referencesKey})`;
        }
        */
        result[columnName] = sql;
      } else {
        result[columnName] = attribute;
      }



    }

    return result;
  }

  addColumnQuery(table, key, dataType, options) {

    const attributes = {};
    attributes[key] = dataType;
    const fields = this.attributesToSQL(attributes, { context: 'addColumn' });
    const attribute = `${this.quoteIdentifier(key)} ${fields[key]}`;
    let sql = `ALTER TABLE ${this.quoteTable(table)} ADD COLUMN `;

    if (options && options.ifNotExists) {
      sql += ' IF NOT EXISTS ';
    }

    sql += `${attribute};`;

    return sql;
  }

  renameColumnQuery(tableName, attrBefore, attributes) {
    const attrString = [];

    for (const attributeName in attributes) {
      attrString.push(
          `${this.quoteIdentifier(attrBefore)} TO ${this.quoteIdentifier(attributeName)}`,
      );
    }

    return `ALTER TABLE ${this.quoteTable(tableName)} RENAME COLUMN ${attrString.join(', ')};`;
  }
}
