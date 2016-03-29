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
import {ContainerInfo} from './discover'

export interface IReporter 
{
    startAsync():Promise<any>;
    registerServiceAsync(service:ContainerInfo) : Promise<ServiceDefinition>;
    getServiceDefinitionAsync(name:string) : Promise<ServiceDefinition>;
    getServiceVersionDefinitionAsync(name:string, version:string) : Promise<ServiceVersionDefinition> ;
    removeServiceAsync(service:ContainerInfo): Promise<ContainerInfo>;   
    watchRuntimeChanges(queue); 
    watchDefinitionsChanges(queue);  
    removeServicesAsync(); 
    getRuntimeServicesAsync(): Promise<Array<any>>;
    notifyRuntimeChangedAsync();
}

export interface ServicePortDefinition 
{
    port:number;
}

export interface ConfigDefinition 
{
    check:string;    
    balance:string;
    scheme:string;    
}

export interface ServiceVersionDefinition extends ConfigDefinition 
{
    publicPath:string;
    version:string;
    status:string;
    enabled:boolean;
    ports:Array<ServicePortDefinition>;
}

export interface ServiceDefinition extends ConfigDefinition 
{
    name:string;
    versions: Array<ServiceVersionDefinition>;
    port:number;
}
