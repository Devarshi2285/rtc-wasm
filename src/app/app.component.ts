import { Component, OnInit } from '@angular/core';
import * as mediasoupClient from 'mediasoup-client';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./video.component.css']
})
export class App implements OnInit {

  private ws!: WebSocket;
  private device: any;

  private sendTransport: any;
  private recvTransport: any;

  private stream!: MediaStream;

  ngOnInit(): void {
    this.ws = new WebSocket('ws://localhost:3000');

    this.ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.action) {

        case 'rtpCapabilities':
          await this.loadDevice(msg.data);
          break;

        case 'sendTransportCreated':
          await this.createSendTransport(msg.data);
          break;

        case 'recvTransportCreated':
          await this.createRecvTransport(msg.data);
          break;

        case 'newProducer':
          await this.consume(msg.data);
          break;
      }
    };
  }

  private send(data: any) {
    this.ws.send(JSON.stringify(data));
  }

  startCall() {
    this.send({ action: 'getRtpCapabilities' });
  }

  // ─────────────────────────────────────────────

  private async loadDevice(routerRtpCapabilities: any) {
    this.device = new mediasoupClient.Device();
    await this.device.load({ routerRtpCapabilities });

    this.send({ action: 'createSendTransport' });
    this.send({ action: 'createRecvTransport' });
  }

  // ─────────────────────────────────────────────
  // SEND TRANSPORT (Local Media)

  private async createSendTransport(params: any) {
    this.sendTransport = this.device.createSendTransport(params);

    this.sendTransport.on('connect',
      ({ dtlsParameters }: any, callback: any) => {
        this.send({
          action: 'connectSendTransport',
          transportId: this.sendTransport.id,
          dtlsParameters
        });
        callback();
      }
    );

    this.sendTransport.on('produce',
      ({ kind, rtpParameters }: any, callback: any) => {
        this.send({
          action: 'produce',
          transportId: this.sendTransport.id,
          kind,
          rtpParameters
        });

        // server must respond with REAL producer id
        callback({ id: Math.random().toString() });
      }
    );

    await this.publish();
  }

  private async publish() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    const video = document.getElementById('localVideo') as HTMLVideoElement;
    video.srcObject = this.stream;

    for (const track of this.stream.getTracks()) {
      await this.sendTransport.produce({ track });
    }
  }

  // ─────────────────────────────────────────────
  // RECEIVE TRANSPORT (Remote Media)

  private async createRecvTransport(params: any) {
    this.recvTransport = this.device.createRecvTransport(params);

    this.recvTransport.on('connect',
      ({ dtlsParameters }: any, callback: any) => {
        this.send({
          action: 'connectRecvTransport',
          transportId: this.recvTransport.id,
          dtlsParameters
        });
        callback();
      }
    );
  }

  // ─────────────────────────────────────────────
  // CONSUME REMOTE PRODUCERS

  private async consume({ producerId, kind }: any) {

    const { id, rtpParameters } = await this.requestConsume(producerId);

    const consumer = await this.recvTransport.consume({
      id,
      producerId,
      kind,
      rtpParameters
    });

    const remoteStream = new MediaStream();
    remoteStream.addTrack(consumer.track);

    const remoteVideo = document.getElementById('remoteVideo') as HTMLVideoElement;
    remoteVideo.srcObject = remoteStream;

    this.send({ action: 'resumeConsumer', consumerId: consumer.id });
  }

  private requestConsume(producerId: string): Promise<any> {
    return new Promise(resolve => {

      const handler = (event: MessageEvent) => {
        const msg = JSON.parse(event.data);

        if (msg.action === 'consumeResponse') {
          this.ws.removeEventListener('message', handler);
          resolve(msg.data);
        }
      };

      this.ws.addEventListener('message', handler);

      this.send({
        action: 'consume',
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      });
    });
  }
}