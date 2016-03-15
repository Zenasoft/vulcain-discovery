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
/// <reference path="../typings/rx/rx.d.ts" />
/// <reference path="../typings/rx/rx-lite.d.ts" />
import {Discover, IRunner, ContainerInfo} from './discover'
import {ConsulReporter} from './consulReporter'
import {EtcdReporter} from './etcdReporter'
import {IReporter} from './reporter'
import {Template} from './template'
import {Options} from './options'
import * as Util from 'util'
var Rx =require('rx')
import {ServiceInfo, VersionInfo} from './template'
import * as events from 'events';

export class Runner implements IRunner 
{
    private discover:Discover;
    private reporter: IReporter;
    private localServices : Map<string, ContainerInfo>;
    private runtimeQueue;
    private defQueue;
    private changes = 0;
    private clusterProxyAddress:string;
    private eventEmitter:events.EventEmitter;
    
    constructor(private options:Options) 
    {
        this.defQueue = new Rx.Subject();
        this.runtimeQueue = new Rx.Subject();
        this.localServices = new Map<string, ContainerInfo>();
        this.discover = new Discover(options, this);
        
        this.createReporter();
        
        this.eventEmitter = new events.EventEmitter();
        this.eventEmitter.on("Error", (err)=> 
        {
           console.log("*** " + err);
           console.log("*** PANIC MODE *** restarting in 30 secondes ...");
           setTimeout(function() 
           {
               process.exit(1);
           }, 30000); 
        });
    }
    
    private createReporter() 
    {
        if(this.options.kv.startsWith("consul://")) {
            this.options.kv = this.options.kv.substr("consul://".length);
            this.reporter = new ConsulReporter(this.options);
        }
        else if(this.options.kv.startsWith("etcd://")) {
            this.options.kv = this.options.kv.substr("etcd://".length);
            this.reporter = new EtcdReporter(this.options);            
        }
        else {
            this.reporter = new ConsulReporter(this.options);         
        }
    }
    
    /**
     * Start by inpecting containers of the current host
     */
    async startAsync() 
    {    
        try 
        {
            this.clusterProxyAddress = await this.discover.findProxyAddressAsync();
            console.log("Proxy address is " + this.clusterProxyAddress);
            
//            await this.reporter.removeServicesAsync();
            this.discover.start(this);            
            await this.reporter.startAsync();
            
            Util.log("Inspecting local containers.");
            let containers =  await this.discover.listContainersAsync();
            containers.forEach(async (container:ContainerInfo)=> 
            {
                if(container)
                    await this.addService(container);
            });
            this.reporter.watchRuntimeChanges(this.runtimeQueue);
            this.reporter.watchDefinitionsChanges(this.defQueue);
            
            this.runtimeQueue
                .debounce(this.options.refresh*1000)
                .subscribe(this.onRuntimeChanged.bind(this)); 
            this.defQueue
                .debounce(this.options.refresh*1000)
                .subscribe(this.refreshLocalAsync.bind(this)); 
        }
        catch(e) {
            Util.log(e);
        }
    }
    
    async refreshLocalAsync() 
    {
        if(this.changes == 0) return;
        try 
        {
            Util.log("Definitions change occurred. Refreshing local containers...");
            let services = [];
            await this.reporter.removeServicesAsync();
            let containers =  await this.discover.listContainersAsync();
            containers.forEach(async (container:ContainerInfo)=> 
            {
                if(container) {
                    container = await this.addService(container);
                    if(container) services.push(container);
                }
            });     
            this.runtimeQueue.onNext(services);
        }
        catch(e) {
            Util.log(e);
        }   
    }
    
    async serviceAdded(id:string) 
    {
        let container = await this.discover.inspectContainerAsync(id);
        if(!container)
        {
            return;
        }
        await this.addService(container);
    }
    
    private async addService(container:ContainerInfo)
    {
        try
        {            
            // Target another specific cluster ?
            if( container.cluster && container.cluster.toLowerCase() !== this.options.cluster.toLowerCase())
                return;
                
            // Is it a valid and enabled version ?
            let vdef = await this.reporter.getServiceVersionDefinitionAsync(container.name, container.version);
            if(!vdef || !vdef.enabled ) return;
            let def = await this.reporter.getServiceDefinitionAsync(container.name);
           
            container.balance = vdef.balance || def.balance;
            container.scheme = vdef.scheme || def.scheme;
            container.check  = vdef.check || def.check;
            container.port = def.port;
            container.address = `${this.clusterProxyAddress}:${def.port}`;
            
            // OK, service can be registered
            await this.reporter.registerServiceAsync(container);
            this.localServices.set(container.id, container);
            
            Util.log(`Service ${container.name} version ${container.version} added (id=${container.id})`);
            return container;
        }
        catch(e) {
            Util.log(e);            
        }
    }
    
    async serviceRemoved(id:string) 
    {
        try 
        {
            let container = this.localServices.get(id);
            if(container) {
                this.localServices.delete(id);
                await this.reporter.removeServiceAsync(container);
                Util.log(`Service ${container.name} version ${container.version} removed (id=${id})`);            
            }
        }
        catch(e) {
            Util.log(e);            
        }
    }
    
    // container {id, version, name, port} -> service(name)/version(version)/[id]
    private async onRuntimeChanged(containers:Array<any>) 
    {      
        this.changes++;
        let services = new Map<string,ServiceInfo>();
        let cx=0;
        for(let kv of containers) 
        {
            let container = kv;
            if(kv.Value !== undefined && kv.Key !== undefined ) { 
                if(kv.Key.split("/").length === 5) continue; // Host info
                container = <ContainerInfo>JSON.parse(kv.Value);
            }
            
            let service = services.get(container.name);
            if(!service)
            {
                let local = this.localServices.get(container.id);
                if(local) {
                    service = {name:local.name, versions:[], port:local.port, scheme:container.scheme};
                    services.set(container.name, service);
                }
            }
            
            let version = service.versions.find(v=>v.version===container.version);
            if(!version) {
                version = {default:true, instances:[], version:container.version, balance:container.balance, check:container.check}
                service.versions.push(version);
                // Set default version (the greater)
                let greaterVersion;
                service.versions.forEach(v=>{
                    if(!greaterVersion || v.version > greaterVersion) { 
                        v.default=true;
                        greaterVersion=v.version;
                    }
                    else
                        v.default=false;
                })
            }
            version.instances.push(container);
            cx++;
        }
        
        // Notify template 
        try 
        {
            let template = new Template(this.options);
            Util.log(`Generating template file with ${services.size} services (${cx} instances)`);
            await template.transformAsync(this.clusterProxyAddress, Array.from(services.values()));
        }
        catch(err) {
            Util.log(err);
        }
    }
}
