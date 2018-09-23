'use strict';

const AWS = require('aws-sdk')
const AJV = require('ajv')
AWS.config.update({region:'eu-west-1'})

const dbConnect = require('./../candidate-profile/libs/dbConnect')

const lambda = new AWS.Lambda({  
  region: "eu-west-1"
});

const ENV = process.env.ENV

const jobsListRequestSchema = require('./schemas/jobs-list-request-schema.json')
const jobsListResponseSchema = require('./schemas/jobs-list-response-schema.json')

const makeSchemaId = schema => `${schema.self.vendor}/${schema.self.name}/${schema.self.version}`

const jobsListRequestSchemaId = makeSchemaId(jobsListRequestSchema)
const jobsListResponseSchemaId = makeSchemaId(jobsListResponseSchema)

const ajv = new AJV()
ajv.addSchema(jobsListRequestSchema, jobsListRequestSchemaId)
ajv.addSchema(jobsListResponseSchema, jobsListResponseSchemaId)

const impl = {
  response: (statusCode, body) => ({
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true,
      'Content-Type': 'application/json'
    },
    body,
  }),
  clientError: (schemaId, ajvErrors, event) => impl.response(
    400,
    `BAD REQUEST: Could not validate request to '${schemaId}' schema. Errors: '${ajvErrors}' found in event: '${JSON.stringify(event)}'`
  ),
  sqlQueryError: (err) => {
    console.log(`Error calling MYSQL: ${err}`)
    return impl.response(500, `ERROR: Error calling MYSQL: ${err}`)
  },
  securityRisk: (schemaId, ajvErrors, items) => {
    console.log(`Could not validate data to '${schemaId}' schema. Errors: ${ajvErrors}`)
    console.log(`Bad data: ${JSON.stringify(items)}`)
    return impl.response(500, `ERROR: SECURITY RISK: Your response did not validate.`)
  },
  success: data => impl.response(200, JSON.stringify(data)),
}

const api = {
  list: (event, context, callback) => {
    if (!ajv.validate(jobsListRequestSchema, event)) { // bad request
      callback(null, impl.clientError(jobsListRequestSchemaId, ajv.errorsText(), event))
    } else {
      const queryStringParameters = event.queryStringParameters
      const userId = queryStringParameters.userId
      const per_page = (queryStringParameters.hasOwnProperty('per_page')) ? queryStringParameters.per_page : 10
      //TODO: Not very reusable to hardcode the published state. Should be removed and done based on user permissions
      const sqlGet = "SELECT * FROM MMK_GXY_Jobs WHERE job_permitted_contact_id = ? AND published = 1 ORDER BY modified_dt DESC, created_dt DESC LIMIT ?"
      const sqlParamsGet = [userId, per_page]
      dbConnect.executeQuery(sqlGet, sqlParamsGet).then( (resultsGet) => {
        if (!ajv.validate(jobsListResponseSchemaId, resultsGet)) {
          callback(null, impl.securityRisk(jobsListResponseSchemaId, ajv.errorsText()), resultsGet)
        } else {
          callback(null, impl.success(resultsGet))        
        }
      }).catch( (error) => {
        callback(null, impl.sqlQueryError(error))
      })
    }
  },  
}

module.exports = {
  list: api.list
}