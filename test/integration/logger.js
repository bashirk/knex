'use strict';

const { expect } = require('chai');
const _ = require('lodash');

const { TEST_TIMESTAMP } = require('../util/constants');

module.exports = function (knex) {
  const client = knex.client;

  // allowed driver name of a client
  const allowedClients = [
    'pg',
    'mssql',
    'mysql',
    'mysql2',
    'oracledb',
    'pg-redshift',
    'sqlite3',
  ];

  function compareBindings(gotBindings, wantedBindings) {
    if (Array.isArray(wantedBindings)) {
      wantedBindings.forEach(function (wantedBinding, index) {
        if (typeof wantedBinding === 'function') {
          expect(
            wantedBinding(gotBindings[index]),
            'binding cheker function failed got: ' + gotBindings
          ).to.equal(true);
        } else {
          expect(wantedBinding).to.eql(gotBindings[index]);
        }
      });
      expect(
        gotBindings.length,
        "length doesn't match got: " + gotBindings
      ).to.equal(wantedBindings.length);
    } else {
      expect(gotBindings).to.eql(wantedBindings);
    }
  }

  // Useful in cases where we want to just test the sql for both PG and SQLite3
  function testSqlTester(qb, driverName, expectedSql, bindings, returnval) {
    if (Array.isArray(driverName)) {
      driverName.forEach(function (val) {
        testSqlTester(qb, val, expectedSql, bindings, returnval);
      });
    } else if (client.driverName === driverName) {
      const actualSql = qb.toSQL();

      if (expectedSql) {
        if (Array.isArray(actualSql)) {
          expect(_.map(actualSql, 'sql')).to.eql(expectedSql);
        } else {
          expect(actualSql.sql).to.equal(expectedSql);
        }
      }
      if (bindings) {
        if (Array.isArray(actualSql)) {
          compareBindings(_.map(actualSql, 'bindings'), bindings);
        } else {
          compareBindings(actualSql.bindings, bindings);
        }
      }
      if (returnval !== undefined && returnval !== null) {
        const oldThen = qb.then;
        qb.then = function () {
          let promise = oldThen.apply(this, []);
          promise = promise.then(function (resp) {
            if (typeof returnval === 'function') {
              expect(!!returnval(resp)).to.equal(true);
            } else {
              expect(stripDates(resp)).to.eql(returnval);
            }
            return resp;
          });
          return promise.then.apply(promise, arguments);
        };
      }
    } else {
      if (!allowedClients.includes(driverName)) {
        throw new Error(
          'Invalid client name: ' +
            driverName +
            ' Should be one of: ' +
            allowedClients.join(',')
        );
      }
    }
  }

  function stripDates(resp) {
    if (!_.isObject(resp[0])) return resp;
    return _.map(resp, function (val) {
      return _.reduce(
        val,
        function (memo, val, key) {
          if (_.includes(['created_at', 'updated_at'], key)) {
            memo[key] = TEST_TIMESTAMP;
          } else {
            memo[key] = val;
          }
          return memo;
        },
        {}
      );
    });
  }

  function makeTestSQL(builder) {
    const tester = testSqlTester.bind(null, builder);
    return function (handler) {
      handler(tester);
      return this;
    };
  }

  const originalRaw = client.raw;
  const originalQueryBuilder = client.queryBuilder;
  const originalSchemaBuilder = client.schemaBuilder;
  client.raw = function () {
    const raw = originalRaw.apply(this, arguments);
    raw.testSql = makeTestSQL(raw);
    return raw;
  };
  client.queryBuilder = function () {
    const qb = originalQueryBuilder.apply(this, arguments);
    qb.testSql = makeTestSQL(qb);
    return qb;
  };
  client.schemaBuilder = function () {
    const sb = originalSchemaBuilder.apply(this, arguments);
    sb.testSql = makeTestSQL(sb);
    return sb;
  };

  return knex;
};
