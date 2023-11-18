import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda"
import { ApiGatewayManagementApi, DynamoDB } from "aws-sdk"
import * as AWSXRay from "aws-xray-sdk"
import { InvoiceTransactionRepository, InvoiceTransactionStatus } from "/opt/nodejs/invoiceTransaction"
import { InvoiceWSService } from "/opt/nodejs/invoiceWSConnection"


AWSXRay.captureAWS(require('aws-sdk'))

const invoicesDdb = process.env.INVOICE_DDB!
const invoicesWsApiEndPoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6)
const ddbClient = new DynamoDB.DocumentClient()
const apigwManagementApi = new ApiGatewayManagementApi({
  endpoint: invoicesWsApiEndPoint
})
const invoiceTransactionRepository = new InvoiceTransactionRepository(ddbClient, invoicesDdb)
const invoiceWsService = new InvoiceWSService(apigwManagementApi)

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  
  const transactionId = JSON.parse(event.body!).transactionId as string
  const lambdaRequestId = context.awsRequestId
  const connectionId = event.requestContext.connectionId!

  console.log(`ConnectionId: ${connectionId} - Lambda RequestId: ${lambdaRequestId}`)

  try {
    const invoiceTransaction = await invoiceTransactionRepository.getInvoiceTransaction(transactionId)
    if (invoiceTransaction.transactionStatus === InvoiceTransactionStatus.GENERATED) {
      await Promise.all([
        invoiceWsService.sendInvoiceStatus(
          transactionId, 
          connectionId, 
          InvoiceTransactionStatus.CANCELLED
        ),
        invoiceTransactionRepository.updateInvoiceTransaction(
          transactionId,
          InvoiceTransactionStatus.CANCELLED
        )
      ])
    } else {
      await invoiceWsService.sendInvoiceStatus(
        transactionId, 
        connectionId, 
        invoiceTransaction.transactionStatus
      )
      console.error("Can't cancel an ongoing process")
    }
  } catch (error) {
    console.log((<Error>error).message)
    console.log(`Invoice transaction not found - TransactionId: ${transactionId}`)
    await invoiceWsService.sendInvoiceStatus(
      transactionId, 
      connectionId, 
      InvoiceTransactionStatus.NOT_FOUND
    )
  }


  return {
    statusCode: 200,
    body: 'OK'
  }
}