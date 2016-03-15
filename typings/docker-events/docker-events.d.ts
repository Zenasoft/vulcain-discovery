/// <reference path="../dockerode/dockerode.d.ts" />

declare class DockerEvents
    {
        constructor(opt?);
        on(event:string, handler);
        start();
    }


declare module "docker-events" {
    export = DockerEvents
}