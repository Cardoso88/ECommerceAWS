import { Context, DynamoDBStreamEvent, AttributeValue } from "aws-lambda";
import { ApiGatewayManagementApi, DynamoDB } from "aws-sdk";
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection";
import * as AWSXRay from "aws-xray-sdk"

AWSXRay.captureAWS(require("aws-sdk"))

const eventsDdb = process.env.EVENTS_DDB!
const invoiceWsApiEndPoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6)

const ddbClient = new DynamoDB.DocumentClient()
const apigwManagementApi = new ApiGatewayManagementApi({
  endpoint: invoiceWsApiEndPoint
})

const invoiceWSService = new InvoiceWSService(apigwManagementApi)
export async function handler (event: DynamoDBStreamEvent, context: Context): Promise<void> {
  const promises: Promise<void>[] = []
  event.Records.forEach((record) => {
    if (record.eventName === 'INSERT') {
      if (record.dynamodb!.NewImage!.pk.S!.startsWith('#transaction')){
        console.log('Invoice transaction event received')
      } else {
        console.log('Invoice event received')
        promises.push(createEvent(record.dynamodb!.NewImage!, "INVOICE_CREATED")) 
      }
    } else if (record.eventName === 'MODIFY') {
    }else if (record.eventName === 'REMOVE') {

    }
  })

  await Promise.all(promises)

  return
}

async function createEvent(invoiceImage: {[key: string]: AttributeValue}, eventType: string) {
  const timestamp = Date.now()
  const ttl =  ~~(timestamp / 1000 + 60 * 60)

  await ddbClient.put({
    TableName: eventsDdb,
    Item: {
      pk: `#invoice_${invoiceImage.sk.S}`,
      sk: `${eventType}#${timestamp}`,
      ttl: ttl,
      email: invoiceImage.pk.S!.split('_')[1],
      createdAt: timestamp,
      eventType: eventType,
      info: {
        transaction: invoiceImage.transactionId.S,
        productId: invoiceImage.productId.S,
        quantity: invoiceImage.quantity.N
      }
    }
  }).promise()

  return
}