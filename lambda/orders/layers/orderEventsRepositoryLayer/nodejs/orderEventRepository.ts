import { DocumentClient } from "aws-sdk/clients/dynamodb";

export interface  OrderEventDdb {
  pk: string;
  sk: string;
  ttl: number;
  email: string;
  createdAt: number;
  requestId: string;
  eventType: string;
  info: {
    orderId: string;
    productCodes: string[];
    messageId: string;
  }
}

export class OrderEventRepository {
  private ddbClient: DocumentClient
  private eventDdb: string

  constructor(ddbClient: DocumentClient, eventsDdb: string) {
    this.ddbClient = ddbClient
    this.eventDdb = eventsDdb
  }

  createOrderEvent(orderEvent: OrderEventDdb) {
    return this.ddbClient.put({
      TableName: this.eventDdb,
      Item: orderEvent
    }).promise()
  }
}