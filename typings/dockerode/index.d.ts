/// <reference path="../node/node.d.ts"/>


interface Options {
        host:string;
        port:number;
        ca?:NodeBuffer;
        cert?:NodeBuffer;
        key?:NodeBuffer;
    }

declare class Docker
    {
        getImage(name:string);
        getContainer(id:string);
        listContainers(func);
        constructor(opt?:Options);
        listNetworks(opt?, callback?);
    }

declare module "dockerode" {
    export = Docker
}