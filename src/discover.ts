//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
//    Copyright (c) Zenasoft
//
// <Reference path="../typings/docker-events/docker-events.d.ts" />
var DockerEvents = require('docker-events');
import {Options} from './options'
import * as fs from 'fs'
import * as Path from 'path'
import * as Url from 'url'
var Docker = require('dockerode');

export interface IRunner 
{
    serviceAdded(id:string);
    serviceRemoved(id:string);    
}

export interface ContainerPortInfo {
    port:number;
    boundedPort:number;
    ip:string;
    localIP:string;
}

export interface ContainerInfo {
    name:string;
    version:string;
    labels: any;
    ports: Array<ContainerPortInfo>;
    id:string;
    image:string;
    balance:string;
    check:string;
    scheme:string;
    port:number;
    defaultVersion?:boolean;
    cluster:string;
    address:string;
    host:string;
    publicPath:string;
}

export class Discover 
{
    private docker : Docker;
    private static Label_Prefix = "vulcain."; 
    private static Label_ServiceName =  Discover.Label_Prefix + "servicename";
    private static Label_ClusterName =  Discover.Label_Prefix + "clustername";
    private static Label_Version = Discover.Label_Prefix + "version";
    private static Label_Info = Discover.Label_Prefix + "info";
        
    constructor(private options:Options, runner:IRunner) 
    {
        let opts;
        let dockerUrl = Url.parse((this.options.dockerAddress && this.options.dockerAddress.startsWith("tcp://") ? "" : "tcp://") + (this.options.dockerAddress || this.options.hostIp));
        if(this.options.certs) { // for debug
            opts = {
                host: dockerUrl.hostname,
                port: dockerUrl.port || 2376,
                ca: fs.readFileSync(Path.join(this.options.certs, "/ca.pem")),
                cert: fs.readFileSync(Path.join(this.options.certs, "/cert.pem")),
                key: fs.readFileSync(Path.join(this.options.certs, "/key.pem"))
            };
        }
        else if(this.options.dockerAddress) {
            opts =  {
                host: dockerUrl.hostname,
                port: dockerUrl.port || 2375
            };
        }
        
        console.log("Starting docker observer on " + (this.options.dockerAddress || "docker.sock"));
        
        // Create docker client
        this.docker = new Docker(opts);
    }
    
    start(runner:IRunner, panic) 
    {
        let emitter = new DockerEvents({docker: this.docker});
        
        emitter.on("start", message => runner.serviceAdded( message.id ));
        emitter.on("die",  message => runner.serviceRemoved( message.id ) );
        emitter.on("stop", message => runner.serviceRemoved( message.id ) );
        emitter.on("kill", message => runner.serviceRemoved( message.id ) );
        emitter.on("destroy", message => runner.serviceRemoved( message.id ) );
        emitter.on("error", (err) => { 
            console.log("Error on listening docker events : " + err);
            emitter.stop(); 
            panic(err);
        });
        
        emitter.start();
        console.log("Listening on docker events...");
    }
    
    inspectContainerAsync(id:string): Promise<ContainerInfo> 
    {
        let self = this;
        return new Promise<ContainerInfo>((resolve,reject)=> 
        {
            this.docker.getContainer(id).inspect(async (err,data)=>
            {
                if(err) {
                    resolve(null);
                    return;
                }
                
                let container = await self.extractInfosFromContainer(data);               
                resolve(container);
            });
        });
    }
    
    private async extractInfosFromContainer(data) 
    {
        try 
        {
            let container = <ContainerInfo>{id:data.Id, ports:[], host: this.options.hostName};
            let image = await this.inspectImageAsync(data.Image);
            if(image) {
                container.image = image.RepoTags && image.RepoTags.length > 0 && image.RepoTags[0];
                // Merge labels from image and container
                let labels = image.Config && image.Config.Labels;
                if(labels)
                    this.extractLabels(container, labels);
                labels = (data.Config && data.Config.Labels) || data.Labels;
                if(labels)
                    this.extractLabels(container, labels);
                    
                if( container.name && container.version)
                {
                    let containerIp = data.NetworkSettings.Networks["net-" + this.options.cluster] && data.NetworkSettings.Networks["net-" + this.options.cluster].IPAddress;
                    if( data.NetworkSettings && data.NetworkSettings.Ports) // event
                        this.extractAlternatePortInfo(containerIp, container, data.NetworkSettings.Ports);
                    else // Inspect
                        this.extractPortInfo(containerIp, container, data.Ports);                  
                    return container; 
                }
            }
        }
        catch(e) {}
    }
    
    private inspectImageAsync(imageName:string): Promise<any> 
    {
        return new Promise((resolve,reject)=> 
        {
            this.docker.getImage(imageName).inspect((err,data)=>
            {
                if(err) {
                    resolve(null);
                    return;
                }
                resolve(data); 
            });
        });
    }
    
    private extractPortInfo(containerIP:string, container:ContainerInfo, ports) 
    {        
        if (ports && containerIP)
        {
            for (let bind of ports)
            {             
                if(bind.Type !== "tcp") continue;
                container.ports.push( {
                    port: bind.PrivatePort,
                    localIP: containerIP,
                    boundedPort: bind.PublicPort || bind.PrivatePort, 
                    ip: (bind.IP !== "0.0.0.0" && bind.IP) || containerIP
                });
            }
        }
    }
    
    private extractAlternatePortInfo(containerIP:string, container:ContainerInfo, ports) 
    {        
        if (ports && containerIP)
        {
            for (let prop in ports)
            {
                if (!ports.hasOwnProperty(prop))
                    continue;

                let parts = prop.split('/');
                if( parts[1] !== "tcp")
                    continue;
                    
                let bind = ports[prop];
                let port = parseInt( parts[0] );
                container.ports.push( {
                    port: port, 
                    localIP: containerIP,
                    boundedPort: (bind && bind[0].HostPort) || port, 
                    ip: (bind && bind[0].HostIp !== "0.0.0.0" && bind[0].HostIp) || containerIP
                });            
            }
        }
    }
    
    private extractLabels(container:ContainerInfo, labels) 
    {            
        for(var label in labels) {

            var lowercaseLabel:string = label.toLowerCase();
            var value = labels[label];
            
            if( lowercaseLabel === Discover.Label_ServiceName && value) {
                container.name = value;
                continue;
            }
            
            if( lowercaseLabel === Discover.Label_ClusterName && value) {
                container.cluster = value;
                continue;
            }
            
            if( lowercaseLabel === Discover.Label_Version && value && value.length > 2) 
            {
                // Normalize version major.minor
                if( value[0] === "v" || value[0] === "V")
                    value = value.substr(1);
                let parts = value.split('.');
                if( parts.length === 2 || parts.length === 3) {
                    container.version = parts[0] + "." + parts[1];
                }
                continue;
            }
          /*  
            // Labels can be include in a full json object
            if( lowercaseLabel.substr(0, Discover.Label_Info.length) === Discover.Label_Info && value) {
                try {
                    var def = JSON.parse(value);
                    if(def) {
                        if(!def.versions) def.versions = [];     
                        // Find version number
                        for(var fn in def.versions) {if(def.versions.hasOwnProperty(fn)) def.version = def.versions[fn].version; }  
                        // Merge properties
                        for(var p in def) {
                            result[p] = def[p];
                        }         
                    }
                }
                catch(ex) {}
                continue;
            }
            */
            // Custom labels
            if( lowercaseLabel.substr(0, Discover.Label_Prefix.length) === Discover.Label_Prefix) 
            {
                container.labels = container.labels || {};
                container.labels[label.substr(Discover.Label_Prefix.length)] = value;
            }
        }
    }
    
    listContainersAsync() 
    {
        let self = this;
        return new Promise<Array<ContainerInfo>>((resolve,reject)=> 
        {
            self.docker.listContainers(async (err,data)=>{
                if(err) {
                    console.log("error listing containers ");
                    reject(err);
                }
                let list = [];
                if(data) {
                    for(let item of data) {
                        let container = await self.extractInfosFromContainer(item); 
                        if(container)
                            list.push(container);
                    }
                }
                resolve(list);
            });
        });
    }
    
    
    findProxyAddressAsync() 
    {
        const self = this;
        const networkName = "net-" + this.options.cluster;
        const proxyContainerName = "local-proxy";
        
        return new Promise<string>((resolve,reject) => 
        {
            // Find private cluster network
            self.docker.listNetworks((err, networks:Array<any>) => 
            {
                let addr=null;
                let network = !err && networks.find(n=>n.Name===networkName);
                if(network)
                {
                    // Search for local-proxy
                    for(var id in network.Containers)
                    {
                        let container = network.Containers[id];
                        if((<string>container.Name).startsWith(proxyContainerName))
                        {
                            addr = <string>container.IPv4Address;
                            let pos = addr.indexOf('/');
                            addr = addr.substr(0, pos);
                            break;
                        }
                    }
                }
                resolve(addr);
            });
        });       
    }
}